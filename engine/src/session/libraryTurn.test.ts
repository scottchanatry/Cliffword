/**
 * A character's question in library mode, judged by the model: the judge reads the reply
 * after the question (with the real model, 'Estoy cansada, gracias.' after a greeting and
 * no question came back corrected to 'cansado'), and a reply it finds natural says so on
 * the repair screen ('turn.accepted') before the example is shown.
 */
import { describe, expect, it } from 'vitest';
import { TEST_LIBRARY, TEST_TRACKS } from '../content/testLibrary';
import { LearnerModel } from '../learner/model';
import { createMockModel } from '../model/mock';
import type { LanguageModel } from '../model/types';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import type { PairPack } from '../pair/types';
import { StorySession } from './story';

const pack = createDefaultSpanishPack();
const pair: PairPack = { ...createDefaultPairPack(), library: TEST_LIBRARY, tracks: TEST_TRACKS };
const T0 = Date.UTC(2026, 10, 19, 9, 0, 0);

/** The mock model, recording every context it scores a continuation of. */
function recordingModel(): { model: LanguageModel; contexts: string[] } {
  const inner = createMockModel();
  const contexts: string[] = [];
  const model: LanguageModel = {
    id: inner.id,
    scoreContinuation: (context, text) => {
      contexts.push(context);
      return inner.scoreContinuation(context, text);
    },
    nextTokens: (context, k) => inner.nextTokens(context, k),
    generate: (prompt, opts) => inner.generate(prompt, opts),
  };
  return { model, contexts };
}

/** Play to the first question with the given address and pack; reply; return what the judge read. */
async function replyToFirstQuestion(address: 'm' | 'f', langPack = pack) {
  const { model, contexts } = recordingModel();
  const s = StorySession.create({ model, pack: langPack, pair, learner: new LearnerModel(), now: T0, seed: 11, library: { startLevel: 0, address }, options: { library: { modelAlternatives: false } } as never });
  let t = T0;
  let step = await s.next((t += 1000));
  for (let guard = 0; step.screen.kind !== 'turn'; guard++) {
    expect(guard).toBeLessThan(20);
    if (step.screen.kind === 'cliff') {
      if (step.screen.phase === 'playing') s.played((t += 10));
      await s.handleUtterance(s.snapshot().state.current?.cliff.answer ?? '', (t += 1000));
    }
    step = await s.next((t += 1000));
  }
  const question = step.screen.kind === 'turn' ? step.screen.prompt.line : '';
  contexts.length = 0;
  const r = await s.handleUtterance('Sí, quiero bananas, gracias.', (t += 1000));
  // The judge's contexts: those holding the story so far (the scoring prefix alone is not one).
  return { question, screen: r.screen, judged: contexts.filter((c) => c.includes('Rosa')) };
}

describe('library turns with a model', () => {
  it('judges the reply after the question and who answers, and says when the reply was natural', async () => {
    for (const [address, cue] of [['f', 'Ella responde:'], ['m', 'Él responde:']] as const) {
      const { question, screen, judged } = await replyToFirstQuestion(address);
      expect(question).toBe('¿Quieres bananas?');
      expect(screen.kind).toBe('repair');
      expect(judged.length).toBeGreaterThan(0);
      for (const c of judged) expect(c.includes(`${question} ${cue}`), c.slice(-80)).toBe(true);
      if (screen.kind === 'repair' && screen.phase === 'ok') expect(screen.ui).toEqual({ key: 'turn.accepted' });
    }
  });

  it('a pack without a reply cue gets the question only', async () => {
    const { question, judged } = await replyToFirstQuestion('f', { ...pack, replyCue: undefined });
    expect(judged.length).toBeGreaterThan(0);
    for (const c of judged) {
      expect(c).toContain(question);
      expect(c).not.toContain('responde');
    }
  });
});
