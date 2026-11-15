import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import { LearnerModel } from '../learner/model';
import { matchCommand } from './commands';
import { NO_SE_STEPS, advanceNoSe, startNoSe } from './noSe';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);
const KEY = 'es:mercado';

describe('no-sé flow', () => {
  it('lists its three steps', () => {
    expect(NO_SE_STEPS).toEqual(['play_answer', 'prompt_repeat', 'align_repeat']);
  });

  it('plays the answer, prompts a repeat, and credits a repeat that landed', () => {
    let s = startNoSe({ answer: 'mercado', key: KEY, at: T0 });
    expect(s.step).toBe('play_answer');
    expect(s.events).toEqual([{ type: 'cliff_skip', key: KEY, at: T0 }]);
    s = advanceNoSe(s, { type: 'played' }, pack);
    expect(s.step).toBe('prompt_repeat');
    expect(s.ui).toEqual({ key: 'cliff.repeatAloud' });
    expect(pair.ui['cliff.repeatAloud']).toBeTruthy();
    s = advanceNoSe(s, { type: 'repeat', transcript: 'Mercado.', at: T0 + 4000 }, pack);
    expect(s.step).toBe('done');
    expect(s.landed).toBe(true);
    expect(s.last?.understood).toBe(1);
    expect(s.events).toEqual([
      { type: 'cliff_skip', key: KEY, at: T0 },
      { type: 'spoke_correct', key: KEY, at: T0 + 4000 },
    ]);
    const learner = new LearnerModel();
    expect(learner.applyAll(s.events)).toBe(2);
  });

  it('lets the learner try again after a miss, then moves on without credit', () => {
    let s = advanceNoSe(startNoSe({ answer: 'al mercado', key: KEY, at: T0 }), { type: 'played' }, pack);
    s = advanceNoSe(s, { type: 'repeat', transcript: 'al merca', at: T0 + 3000 }, pack);
    expect(s.step).toBe('prompt_repeat');
    expect(s.repeats).toBe(1);
    expect(s.landed).toBe(false);
    expect(s.last?.words.map((w) => w.outcome)).toEqual(['landed', 'substituted']);
    s = advanceNoSe(s, { type: 'repeat', transcript: 'a mercado', at: T0 + 6000 }, pack);
    expect(s.step).toBe('done');
    expect(s.landed).toBe(false);
    expect(s.events).toEqual([{ type: 'cliff_skip', key: KEY, at: T0 }]);
    // Done is final.
    expect(advanceNoSe(s, { type: 'repeat', transcript: 'al mercado', at: T0 + 9000 }, pack)).toBe(s);
  });

  it('replays on "otra vez" and "más despacio", and ends on "siguiente"', () => {
    let s = advanceNoSe(startNoSe({ answer: 'mercado', key: KEY, at: T0 }), { type: 'played' }, pack);
    const said = matchCommand('más despacio', pack, { answer: s.answer });
    expect(said?.command).toBe('slower');
    s = advanceNoSe(s, { type: 'replay', slower: said?.command === 'slower' }, pack);
    expect(s.step).toBe('play_answer');
    expect(s.slower).toBe(true);
    expect(advanceNoSe(s, { type: 'played' }, pack).step).toBe('prompt_repeat');
    const skipped = advanceNoSe(s, { type: 'skip' }, pack);
    expect(skipped.step).toBe('done');
    expect(skipped.events).toEqual([{ type: 'cliff_skip', key: KEY, at: T0 }]);
  });

  it('accepts a repeat while the answer is still playing, and ignores a stray "played"', () => {
    const s = startNoSe({ answer: 'mercado', key: KEY, at: T0 });
    expect(advanceNoSe(s, { type: 'repeat', transcript: 'mercado', at: T0 + 1000 }, pack).landed).toBe(true);
    const prompting = advanceNoSe(s, { type: 'played' }, pack);
    expect(advanceNoSe(prompting, { type: 'played' }, pack)).toBe(prompting);
  });

  it('repeating an answer that is also a command word is the answer, not the command', () => {
    const s = advanceNoSe(startNoSe({ answer: 'siguiente', key: 'es:siguiente', at: T0 }), { type: 'played' }, pack);
    expect(matchCommand('Siguiente', pack, { answer: s.answer })).toBeNull();
    expect(advanceNoSe(s, { type: 'repeat', transcript: 'Siguiente', at: T0 + 2000 }, pack).landed).toBe(true);
  });

  it('accepts clipped forms in street register', () => {
    const s = advanceNoSe(startNoSe({ answer: "pa'l campo", key: 'es:campo', at: T0 }), { type: 'played' }, pack);
    expect(advanceNoSe(s, { type: 'repeat', transcript: 'para el campo', at: T0 + 2000 }, pack).landed).toBe(false);
    expect(advanceNoSe(s, { type: 'repeat', transcript: 'para el campo', at: T0 + 2000 }, pack, { register: 'street' }).landed).toBe(true);
  });

  it('can count a partial repeat with a lower landedShare', () => {
    const s = advanceNoSe(startNoSe({ answer: 'en el puesto', key: 'es:puesto', at: T0 }), { type: 'played' }, pack);
    expect(advanceNoSe(s, { type: 'repeat', transcript: 'el puesto', at: T0 + 2000 }, pack).landed).toBe(false);
    expect(advanceNoSe(s, { type: 'repeat', transcript: 'el puesto', at: T0 + 2000 }, pack, { landedShare: 0.6 }).landed).toBe(true);
  });
});
