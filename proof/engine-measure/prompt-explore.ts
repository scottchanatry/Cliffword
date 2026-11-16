/**
 * Prompt formats for next-sentence generation on Qwen3-1.7B, compared on the real model.
 *
 * Usage (from engine/, with proof/model_server.py listening):
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8771 npx vite-node ../proof/engine-measure/prompt-explore.ts [formats] [seeds] [n]
 *
 * Every format is plain continuation (no chat template), the way model_server.py
 * /generate works. For each simulated learner and format it samples n candidates per
 * seed, cleans each to one sentence with the engine's extractSentence and scores it with
 * the engine's evaluateCandidate. Results: results/prompt-explore.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  buildContinuationPrompt,
  chooseTargets,
  deriveParams,
  estimateVocabulary,
  evaluateCandidate,
  extractSentence,
  lexemeOf,
  maxTokensFor,
  targetWordsFromKeys,
} from '../../engine/src/index';
import { HttpLanguageModel } from '../../engine/src/model/http';
import { KEYS, OPENINGS, PROFILES, learnerFor, pack, pair } from './learners';
import type { ProfileId } from './learners';

const OUT = new URL('./results', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8771';
const model = new HttpLanguageModel({ baseUrl: BASE, timeoutMs: 600_000 });
const NOW = Date.UTC(2026, 10, 15, 9, 0, 0);
const formats = (process.argv[2] ?? 'F0,F1,F2,F3').split(',');
const seeds = (process.argv[3] ?? '1,2').split(',').map(Number);
const N = Number(process.argv[4] ?? 4);
const profiles = (process.argv[5] ?? 'brandNew,early,reader,advanced,heritage').split(',') as ProfileId[];

const LEVEL: Record<ProfileId, string> = { brandNew: 'A1', early: 'A1', reader: 'B1', advanced: 'C1', heritage: 'B2' };
const SENTENCE_STOPS = ['. ', '? ', '! ', '\n'];

interface Scenario {
  id: ProfileId;
  story: string[];
  targets: string[];
  targetWords: string[];
  vocab: string[];
  familiar: Set<string>;
  params: ReturnType<typeof deriveParams>;
}

function scenario(id: ProfileId): Scenario {
  const learner = learnerFor(id);
  const params = deriveParams({ vocab: estimateVocabulary(learner, NOW, KEYS) });
  const familiar = new Set<string>();
  let targets: string[];
  let vocab: string[] = [];
  if (id === 'brandNew') {
    const st = pair.starter!;
    for (const l of st.taught) familiar.add(`es:${l}`);
    for (const c of pair.cognates) familiar.add(`es:${c}`);
    // Every word of the starter sentences was met with a gloss.
    for (const x of st.sentences) for (const seg of pack.segment(x.text)) if (seg.kind === 'word') {
      const a = pack.analyze(seg.norm)[0];
      if (a) familiar.add(`es:${a.lemma}`);
    }
    // The first frequent lemma outside the familiar set: what the bridge would teach.
    targets = KEYS.filter((k) => !familiar.has(k)).slice(0, 1);
    const inStory = new Set<string>();
    for (const s of OPENINGS.brandNew) for (const seg of pack.segment(s)) if (seg.kind === 'word') {
      const a = pack.analyze(seg.norm)[0];
      if (a && a.pos !== 'PROPN' && familiar.has(`es:${a.lemma}`)) inStory.add(a.lemma);
    }
    vocab = [...new Set([...st.taught, 'ella', 'tocar', 'ir', 'a', 'hoy', 'después', ...inStory, 'hotel', 'café', 'banana', 'chocolate', 'animal', 'teléfono'])];
  } else {
    targets = chooseTargets({ learner, now: NOW, frequencyKeys: KEYS, options: { count: 1 } }).map((t) => t.key);
    if (id === 'early') {
      vocab = KEYS.filter((k) => learner.pKnown(k, 'meaning', NOW) >= 0.9)
        .map((k) => lexemeOf(k).slice(3))
        .filter((l) => ['NOUN', 'VERB', 'ADJ'].includes(pack.analyze(l)[0]?.pos ?? ''))
        .slice(0, 40);
    }
  }
  return { id, story: OPENINGS[id], targets, targetWords: targetWordsFromKeys(targets), vocab, familiar, params };
}

function header(s: Scenario, withVocab: boolean): string[] {
  const lines = [`Cuento corto en español fácil (nivel ${LEVEL[s.id]}).`, 'Personajes: Marta.'];
  if (withVocab && s.vocab.length) lines.push(`Palabras conocidas: ${s.vocab.join(', ')}.`);
  if (s.targetWords.length) lines.push(`Palabra nueva: ${s.targetWords.join(', ')}.`);
  return lines;
}

/** prompt, stop strings, cue (prepended to each completion). */
const FORMATS: Record<string, (s: Scenario) => { prompt: string; stop: string[]; cue: string }> = {
  // Baseline: the current instruction prompt (story/prompt.ts).
  F0: (s) => ({
    prompt: buildContinuationPrompt(s.story, { targets: s.targetWords, maxWords: s.params.sentenceWords.max, register: 'neutral' }),
    stop: ['\n'],
    cue: '',
  }),
  // Header + story as one paragraph; the model continues the paragraph.
  F1: (s) => ({ prompt: `${header(s, true).join('\n')}\n\n${s.story.slice(-4).join(' ')}`, stop: SENTENCE_STOPS, cue: '' }),
  // Header + one sentence per line; the prompt ends with a newline.
  F2: (s) => ({ prompt: `${header(s, true).join('\n')}\n\n${s.story.slice(-4).join('\n')}\n`, stop: SENTENCE_STOPS, cue: '' }),
  // F2 with the main character's name as a sentence-start cue.
  F3: (s) => ({ prompt: `${header(s, true).join('\n')}\n\n${s.story.slice(-4).join('\n')}\nMarta`, stop: SENTENCE_STOPS, cue: 'Marta' }),
  // F2 without the vocabulary line.
  F4: (s) => ({ prompt: `${header(s, false).join('\n')}\n\n${s.story.slice(-4).join('\n')}\n`, stop: SENTENCE_STOPS, cue: '' }),
  // F1 with a dash list of sentences ("- "), a cue the model keeps.
  F5: (s) => ({ prompt: `${header(s, true).join('\n')}\n\n${s.story.slice(-4).map((x) => `- ${x}`).join('\n')}\n-`, stop: SENTENCE_STOPS, cue: '' }),
  // F2 with the new word announced on the line before the next sentence.
  F6: (s) => ({
    prompt: `${header(s, true).filter((l) => !l.startsWith('Palabra nueva')).join('\n')}\n\n${s.story.slice(-4).join('\n')}\n(Siguiente frase, con la palabra «${s.targetWords[0]}»:)\n`,
    stop: SENTENCE_STOPS,
    cue: '',
  }),
};

/** The rarest lemma of a sentence (not a name): the tag of a story line in the tagged formats. */
function rarest(text: string): string {
  let best = '';
  let bestRank = -1;
  for (const seg of pack.segment(text)) {
    if (seg.kind !== 'word') continue;
    const a = pack.analyze(seg.norm)[0];
    if (!a || a.pos === 'PROPN') continue;
    const r = pack.frequencyRank(a.lemma) ?? 5000;
    if (r > bestRank) { bestRank = r; best = seg.text.toLowerCase(); }
  }
  return best;
}
FORMATS.F7 = (s) => ({
  prompt: `${header(s, true).filter((l) => !l.startsWith('Palabra nueva')).join('\n')}\n\n${s.story.slice(-4).join('\n')}\n(Una frase corta con «${s.targetWords[0]}».)\n`,
  stop: SENTENCE_STOPS,
  cue: '',
});
// Tagged lines: each story sentence after its rarest word in brackets; the prompt ends with the target's tag.
FORMATS.F8 = (s) => ({
  prompt: `${header(s, true).filter((l) => !l.startsWith('Palabra nueva')).join('\n')}\n\n${s.story.slice(-4).map((x) => `[${rarest(x)}] ${x}`).join('\n')}\n[${s.targetWords[0]}]`,
  stop: SENTENCE_STOPS,
  cue: '',
});
// F8 without the vocabulary line.
FORMATS.F9 = (s) => ({
  prompt: `${header(s, false).filter((l) => !l.startsWith('Palabra nueva')).join('\n')}\n\n${s.story.slice(-4).map((x) => `[${rarest(x)}] ${x}`).join('\n')}\n[${s.targetWords[0]}]`,
  stop: SENTENCE_STOPS,
  cue: '',
});

// Round 2 formats. G1: level header, characters, vocabulary line (small vocabularies only),
// tagged story lines, the target as the last tag. G2: the same without the vocabulary line.
// G3: G1 with the main character as the tag (a 'safe' group without the target).
// G4: G1 without the header lines (only the vocabulary line and the tagged story).
const SHORT: Partial<Record<ProfileId, string>> = { brandNew: ' Frases muy cortas.', early: ' Frases cortas.' };
function gHeader(s: Scenario, vocab: boolean): string {
  const lines = [`Cuento en español (nivel ${LEVEL[s.id]}).${SHORT[s.id] ?? ''}`, 'Personajes: Marta.'];
  if (vocab && s.vocab.length) lines.push(`Palabras: ${s.vocab.join(', ')}.`);
  return lines.join('\n');
}
const tagged = (s: Scenario) => s.story.slice(-4).map((x) => `[${rarest(x)}] ${x}`).join('\n');
FORMATS.G1 = (s) => ({ prompt: `${gHeader(s, true)}\n\n${tagged(s)}\n[${s.targetWords[0]}]`, stop: SENTENCE_STOPS, cue: '' });
FORMATS.G2 = (s) => ({ prompt: `${gHeader(s, false)}\n\n${tagged(s)}\n[${s.targetWords[0]}]`, stop: SENTENCE_STOPS, cue: '' });
FORMATS.G3 = (s) => ({ prompt: `${gHeader(s, true)}\n\n${tagged(s)}\n[Marta]`, stop: SENTENCE_STOPS, cue: '' });
FORMATS.G4 = (s) => ({ prompt: `${s.vocab.length ? `Palabras: ${s.vocab.join(', ')}.\n\n` : ''}${tagged(s)}\n[${s.targetWords[0]}]`, stop: SENTENCE_STOPS, cue: '' });

const rows: unknown[] = [];
const summary: Record<string, Record<string, unknown>> = {};
for (const id of profiles) {
  const s = scenario(id);
  console.log(`\n== ${PROFILES[id].name}: targets ${s.targets.join(',')} len ${s.params.sentenceWords.min.toFixed(1)}-${s.params.sentenceWords.max.toFixed(1)}`);
  for (const f of formats) {
    const { prompt, stop, cue } = FORMATS[f]!(s);
    const maxTokens = f === 'F0' ? maxTokensFor(s.params.sentenceWords.max, { tokensPerWord: 2, extraTokens: 8 }) : Math.ceil(s.params.sentenceWords.max * 2) + 6;
    let ms = 0;
    const evals: { text: string; raw: string; inBand: boolean; famBand: boolean; target: boolean; verb: boolean; words: number }[] = [];
    for (const seed of seeds) {
      const t0 = performance.now();
      const raw = await model.generate(prompt, { n: N, maxTokens, temperature: Number(process.env.TEMP ?? 0.8), stop, seed });
      ms += performance.now() - t0;
      for (const r of raw) {
        const text = extractSentence(cue + r, { nativeLexicon: pair.nativeLexicon });
        const e = evaluateCandidate(text, 0, { pack, learner: learnerFor(id), now: NOW, targets: s.targets, params: s.params, previous: s.story, pair });
        const counted = e.words.filter((w) => w.counted && !w.target);
        const fam = counted.length ? counted.filter((w) => w.pKnown >= 0.5 || s.familiar.has(w.key)).length / counted.length : 1;
        evals.push({
          text, raw: r, inBand: e.accepted && e.inBand, famBand: e.accepted && fam >= s.params.knownBand.min,
          target: e.targetsHit.length > 0, verb: e.words.some((w) => w.pos === 'VERB' || w.pos === 'AUX'), words: e.wordCount,
        });
      }
    }
    const n = evals.length;
    const share = (p: (e: (typeof evals)[number]) => boolean) => +(evals.filter(p).length / n).toFixed(2);
    const sum = {
      inBand: share((e) => e.inBand), famBand: share((e) => e.famBand), target: share((e) => e.target), verb: share((e) => e.verb),
      inLength: share((e) => e.words >= Math.floor(s.params.sentenceWords.min) && e.words <= Math.ceil(s.params.sentenceWords.max)),
      distinct: new Set(evals.map((e) => e.text)).size, n, msPerCall: Math.round(ms / seeds.length), promptChars: prompt.length,
    };
    (summary[id] ??= {})[f] = sum;
    console.log(f, JSON.stringify(sum));
    for (const e of evals) console.log('   ', e.inBand ? 'B' : e.famBand ? 'f' : '-', e.target ? 'T' : '-', e.verb ? 'V' : '-', e.text);
    rows.push({ profile: id, format: f, prompt, ...sum, evals });
  }
}
writeFileSync(`${OUT}/prompt-explore${process.argv[6] ?? ''}.json`, JSON.stringify({ date: new Date().toISOString(), seeds, n: N, summary, rows }, null, 1));
