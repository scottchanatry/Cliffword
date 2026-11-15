import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import { createMockModel } from '../model/mock';
import type { LanguageModel } from '../model/types';
import { judgeSentence } from '../corrections/judge';
import { LearnerModel } from '../learner/model';
import { scoringPrefix } from '../scoring/context';
import {
  attemptRepair,
  blamedKey,
  isRepairFinal,
  judgeAttempt,
  repairEvents,
  repairFlow,
  repairOverlap,
  startRepair,
} from './repair';
import type { RepairState } from './repair';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const model = createMockModel();
const T1 = Date.UTC(2026, 10, 15, 9, 0, 0);
const T2 = T1 + 15000;
const T3 = T2 + 15000;

/** The mock with every scoreContinuation call reported to `onScore`. */
function watched(onScore: (context: string) => void): LanguageModel {
  return {
    id: model.id,
    scoreContinuation: (context, text) => {
      onScore(context);
      return model.scoreContinuation(context, text);
    },
    nextTokens: (context, k) => model.nextTokens(context, k),
    generate: (prompt, o) => model.generate(prompt, o),
  };
}

const WRONG = 'Soy muy cansado porque nadamos mucho.';
const RIGHT = 'Estoy muy cansado porque nadamos mucho.';

/** Judge with the real pack and the mock, after the neutral prefix, and step the flow. */
async function step(state: RepairState, text: string, at: number, flow = {}): Promise<RepairState> {
  return repairFlow(state, { type: 'attempt', text, at, judgement: await judgeAttempt(model, pack, text) }, pack, flow);
}

describe('judgeAttempt', () => {
  it('judges after the fixed prefix of the pack', async () => {
    const seen: string[] = [];
    const recording = watched((c) => seen.push(c));
    const j = await judgeAttempt(recording, pack, WRONG);
    expect(j.verdict).toBe('assert');
    expect(j.explainKey).toBe('es.ser_estar');
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((c) => c.startsWith('Frase en español:\n'))).toBe(true);
    // Same as calling judgeSentence with the prefix by hand.
    expect(j).toEqual(await judgeSentence(model, pack, 'Frase en español:\n', WRONG));
  });

  it('uses the street prefix naming the slang of the attempt, and protects slang', async () => {
    const seen: string[] = [];
    const recording = watched((c) => seen.push(c));
    const text = "El corillo 'tá en la playa.";
    const j = await judgeAttempt(recording, pack, text, { register: 'street', before: 'Ayer llovió.' });
    expect(j.verdict).toBe('ok');
    const prefix = scoringPrefix(pack, { register: 'street', words: ['corillo', "'tá"] });
    expect(seen[0]).toBe(prefix + 'Ayer llovió.');
    expect(seen[0]).toContain('corillo');
    expect(seen[0]).toContain("'tá");
  });
});

describe('repairFlow', () => {
  it('prompts a repair on an assert, shading the word and hiding the explanation', async () => {
    const s = await step(startRepair(), WRONG, T1);
    expect(s.phase).toBe('prompt_repair');
    expect(s.highlight).toMatchObject({ wordIndex: 0, start: 0, end: 3, text: 'Soy', heat: 2 });
    expect(['AUX', 'VERB']).toContain(s.highlight?.pos);
    expect(s.explainKey).toBeNull();
    expect(s.expected).toBeNull();
    expect(s.ui).toEqual({ key: 'repair.prompt' });
    expect(pair.ui['repair.prompt']).toBeTruthy();
    expect(isRepairFinal(s)).toBe(false);
    expect(repairEvents(s, pack)).toEqual([]);
  });

  it('ends repaired when the learner fixes it on the second try', async () => {
    const prompted = await step(startRepair(), WRONG, T1);
    const s = await step(prompted, RIGHT, T2);
    expect(s.phase).toBe('repaired');
    expect(s.repairs).toBe(1);
    expect(s.highlight).toBeNull();
    expect(s.explainKey).toBeNull();
    expect(s.ui).toBeNull();
    expect(s.attempts.map((a) => a.text)).toEqual([WRONG, RIGHT]);

    const events = repairEvents(s, pack);
    expect(events[0]).toEqual({ type: 'spoke_error', key: 'es:ser', at: T1 });
    const correct = events.filter((e) => e.type === 'spoke_correct');
    expect(correct.map((e) => e.key)).toEqual(['es:estar', 'es:muy', 'es:cansado', 'es:porque', 'es:nadar', 'es:mucho']);
    expect(correct.every((e) => e.at === T2)).toBe(true);
  });

  it('shows the answer with its explanation when the second try is still wrong', async () => {
    const prompted = await step(startRepair(), WRONG, T1);
    const s = await step(prompted, WRONG, T2);
    expect(s.phase).toBe('show_answer');
    expect(s.expected).toBe(RIGHT);
    expect(s.explainKey).toBe('es.ser_estar');
    expect(pair.explanations[s.explainKey as string]).toBeTruthy();
    expect(s.ui).toEqual({ key: 'repair.fix', params: { fix: RIGHT, expected: RIGHT } });
    expect(s.gaveUp).toBe(false);
    const events = repairEvents(s, pack);
    expect(events.filter((e) => e.type === 'spoke_error')).toEqual([{ type: 'spoke_error', key: 'es:ser', at: T1 }]);
    // The other words of the sentence were used correctly.
    expect(events.filter((e) => e.type === 'spoke_correct').map((e) => e.key)).toContain('es:cansado');
    expect(events.some((e) => e.type === 'spoke_correct' && e.key === 'es:ser')).toBe(false);
  });

  it('allows more repair tries when maxRepairs says so', async () => {
    const prompted = await step(startRepair(), WRONG, T1, { maxRepairs: 2 });
    const again = await step(prompted, WRONG, T2, { maxRepairs: 2 });
    expect(again.phase).toBe('prompt_repair');
    expect(again.repairs).toBe(1);
    const done = await step(again, RIGHT, T3, { maxRepairs: 2 });
    expect(done.phase).toBe('repaired');
    expect(done.repairs).toBe(2);
  });

  it('shows the answer when the learner asks for it, and not before an attempt', async () => {
    const start = startRepair();
    expect(repairFlow(start, { type: 'give_up', at: T1 }, pack)).toBe(start);
    const prompted = await step(start, WRONG, T1);
    const s = repairFlow(prompted, { type: 'give_up', at: T2 }, pack);
    expect(s.phase).toBe('show_answer');
    expect(s.gaveUp).toBe(true);
    expect(s.expected).toBe(RIGHT);
    expect(s.explainKey).toBe('es.ser_estar');
  });

  it('treats a different sentence as no repair, and shows the answer to the flagged one', async () => {
    const prompted = await step(startRepair(), WRONG, T1);
    const s = await step(prompted, 'Me gusta la playa.', T2);
    expect(s.phase).toBe('show_answer');
    expect(s.expected).toBe(RIGHT);
    expect(s.explainKey).toBe('es.ser_estar');
    expect(repairOverlap(pack, s.attempts[0] as never, 'Me gusta la playa.', { register: 'neutral', regions: [] })).toBeLessThan(0.5);
    expect(repairOverlap(pack, s.attempts[0] as never, RIGHT, { register: 'neutral', regions: [] })).toBe(1);
  });

  it('accepts an ok sentence at once, with spoke_correct for its known words', async () => {
    const s = await step(startRepair(), 'Marta compró pan.', T1);
    expect(s.phase).toBe('ok');
    expect(s.ui).toBeNull();
    const events = repairEvents(s, pack);
    // Names give no speaking evidence.
    expect(events).toEqual([
      { type: 'spoke_correct', key: 'es:comprar', at: T1 },
      { type: 'spoke_correct', key: 'es:pan', at: T1 },
    ]);
  });

  it('shades a hint lightly and shows what was expected, without a repair prompt or an error event', async () => {
    const s = await step(startRepair(), 'Veo mi madre.', T1);
    expect(s.phase).toBe('hinted');
    expect(s.expected).toBe('Veo a mi madre.');
    expect(s.highlight).toMatchObject({ text: 'mi', heat: 1 });
    expect(s.explainKey).toBeNull();
    expect(s.ui).toEqual({ key: 'repair.expected', params: { expected: 'Veo a mi madre.' } });
    const events = repairEvents(s, pack);
    expect(events.some((e) => e.type === 'spoke_error')).toBe(false);
    expect(events.map((e) => e.key)).toEqual(['es:ver', 'es:mi', 'es:madre']);
  });

  it('can prompt repairs on hints too', async () => {
    const s = await step(startRepair(), 'Veo mi madre.', T1, { repairOn: ['assert', 'hint'] });
    expect(s.phase).toBe('prompt_repair');
    const fixed = await step(s, 'Veo a mi madre.', T2, { repairOn: ['assert', 'hint'] });
    expect(fixed.phase).toBe('repaired');
    // The blamed word of an insert is the inserted word.
    expect(repairEvents(fixed, pack, { repairOn: ['assert', 'hint'] })[0]).toEqual({ type: 'spoke_error', key: 'es:a', at: T1 });
  });

  it('never accepts an asserted sentence as ok, whatever repairOn says', async () => {
    const s = await step(startRepair(), WRONG, T1, { repairOn: ['hint'] });
    expect(s.phase).toBe('hinted');
    expect(s.expected).toBe(RIGHT);
    expect(repairEvents(s, pack, { repairOn: ['hint'] }).some((e) => e.key === 'es:ser')).toBe(false);
  });

  it('blames the inserted word for a missing word', async () => {
    const judgement = await judgeSentence(model, pack, '', 'Veo mi madre.');
    expect(judgement.verdict).toBe('assert');
    expect(judgement.best?.kind).toBe('insert');
    expect(blamedKey({ text: 'Veo mi madre.', at: T1, judgement }, pack)).toBe('es:a');
  });

  it('leaves a final state unchanged', async () => {
    const done = await step(startRepair(), 'Marta compró pan.', T1);
    expect(await step(done, WRONG, T2)).toBe(done);
    expect(repairFlow(done, { type: 'give_up', at: T2 }, pack)).toBe(done);
  });

  it('runs the judge and the flow together with attemptRepair', async () => {
    let calls = 0;
    const counting = watched(() => calls++);
    const prompted = await attemptRepair(startRepair(), counting, pack, WRONG, T1);
    expect(prompted.phase).toBe('prompt_repair');
    const repaired = await attemptRepair(prompted, counting, pack, RIGHT, T2);
    expect(repaired.phase).toBe('repaired');
    const before = calls;
    expect(await attemptRepair(repaired, counting, pack, WRONG, T3)).toBe(repaired);
    expect(calls).toBe(before); // a final state never calls the model
  });

  it('suggests events the learner model accepts', async () => {
    const prompted = await step(startRepair(), WRONG, T1);
    const s = await step(prompted, RIGHT, T2);
    const learner = new LearnerModel();
    const before = learner.pKnown('es:estar', 'speaking', T3);
    expect(learner.applyAll(repairEvents(s, pack))).toBe(repairEvents(s, pack).length);
    expect(learner.pKnown('es:estar', 'speaking', T3)).toBeGreaterThan(before);
    expect(learner.pKnown('es:ser', 'speaking', T3)).toBeLessThan(before);
  });
});
