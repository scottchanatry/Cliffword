import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEARNER_PARAMS,
  DEFAULT_PRIOR,
  EVENT_EVIDENCE,
  LearnerModel,
  evidenceFor,
  initialHalfLife,
  recallAt,
  recallFloor,
  resolveLearnerParams,
  updateMemory,
  type EventEvidenceTable,
  type LearnerEventType,
  type PriorFn,
} from './model';
import { formKey, lexemeKey, SKILLS, type CliffRung, type LearnerEvent, type Skill } from './types';

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);

const TENER = lexemeKey('es', 'tener');
const TUVIERON = formKey('es', 'tener', { mood: 'ind', number: 'p', person: '3', tense: 'pret' });
const TENGO = formKey('es', 'tener', { mood: 'ind', number: 's', person: '1', tense: 'pres' });

function ev(type: Exclude<LearnerEventType, 'cliff_answer'>, key: string, at: number): LearnerEvent {
  return { type, key, at } as LearnerEvent;
}

function cliff(key: string, at: number, credit: 'full' | 'partial' | 'none', rung: CliffRung): LearnerEvent {
  return { type: 'cliff_answer', key, at, credit, rung };
}

describe('EVENT_EVIDENCE', () => {
  const types: LearnerEventType[] = [
    'heard', 'tap_rehear', 'hold_reveal', 'read', 'gloss_lookup', 'cliff_answer',
    'cliff_skip', 'spoke_correct', 'spoke_error', 'native_gap', 'marked_known',
  ];

  it('covers every event type, credit and rung with weights in (0, 1]', () => {
    const lists: (readonly { skill: Skill; weight: number }[])[] = [];
    for (const t of types) {
      if (t === 'cliff_answer') {
        for (const credit of ['full', 'partial', 'none'] as const) {
          for (const rung of ['options', 'hint', 'free'] as const) lists.push(EVENT_EVIDENCE.cliff_answer[credit][rung]);
        }
      } else {
        lists.push(EVENT_EVIDENCE[t]);
      }
    }
    for (const list of lists) {
      expect(list.length).toBeGreaterThan(0);
      for (const e of list) {
        expect(SKILLS).toContain(e.skill);
        expect(e.weight).toBeGreaterThan(0);
        expect(e.weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('cliff_answer: full speaking evidence is strongest free, weakest with options', () => {
    const speak = (credit: 'full' | 'none', rung: CliffRung, success: boolean) =>
      EVENT_EVIDENCE.cliff_answer[credit][rung].find((e) => e.skill === 'speaking' && e.success === success)?.weight ?? 0;
    expect(speak('full', 'free', true)).toBe(1);
    expect(speak('full', 'free', true)).toBeGreaterThan(speak('full', 'hint', true));
    expect(speak('full', 'hint', true)).toBeGreaterThan(speak('full', 'options', true));
    // none is a speaking failure at every rung, strongest when the most help was given.
    for (const rung of ['options', 'hint', 'free'] as const) expect(speak('none', rung, false)).toBeGreaterThan(0);
    expect(speak('none', 'options', false)).toBeGreaterThan(speak('none', 'free', false));
  });

  it('maps events through evidenceFor, including cliff credit and rung', () => {
    expect(evidenceFor(ev('gloss_lookup', TENER, T0))).toEqual([{ skill: 'meaning', success: false, weight: 1 }]);
    expect(evidenceFor(cliff(TENER, T0, 'full', 'free'))).toBe(EVENT_EVIDENCE.cliff_answer.full.free);
    expect(evidenceFor(cliff(TENER, T0, 'none', 'options'))).toBe(EVENT_EVIDENCE.cliff_answer.none.options);
    expect(evidenceFor(ev('hold_reveal', TENER, T0)).every((e) => e.skill === 'sound' && !e.success)).toBe(true);
  });
});

describe('memory math', () => {
  const params = resolveLearnerParams();

  it('recall decays towards its floor, which follows the share of successful evidence', () => {
    const st = { halfLifeHours: 10, lastAt: T0, level: 0.9, evidence: 2, lapses: 0 };
    expect(recallAt(st, T0, 0.5)).toBeCloseTo(0.9, 12);
    expect(recallAt(st, T0 + 10 * H, 0.5)).toBeCloseTo(0.7, 12);
    expect(recallAt(st, Number.POSITIVE_INFINITY, 0.5)).toBeCloseTo(0.5, 12);
    expect(recallFloor(st, 0.5)).toBe(0.5);
    expect(recallFloor({ evidence: 2, lapses: 2 }, 0.5)).toBe(0);
    expect(recallFloor({ evidence: 4, lapses: 1 }, 0.8)).toBeCloseTo(0.6, 12);
    expect(recallFloor({ evidence: 0, lapses: 0 }, 0.8)).toBe(0);
  });

  it('recall halves every half-life and never uses negative elapsed time', () => {
    const st = { halfLifeHours: 10, lastAt: T0, level: 1, evidence: 1, lapses: 0 };
    expect(recallAt(st, T0)).toBe(1);
    expect(recallAt(st, T0 + 10 * H)).toBeCloseTo(0.5, 12);
    expect(recallAt(st, T0 + 20 * H)).toBeCloseTo(0.25, 12);
    expect(recallAt(st, T0 - 5 * H)).toBe(1);
    expect(recallAt(st, Number.NaN)).toBe(1);
    expect(recallAt(st, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('starting half-life grows with the prior', () => {
    expect(initialHalfLife(0, params)).toBe(24);
    expect(initialHalfLife(0.5, params)).toBeCloseTo(24 * 16, 9);
    expect(initialHalfLife(1, params)).toBeCloseTo(24 * 256, 9);
  });

  it('spaced success grows the half-life more than massed success', () => {
    const base = { halfLifeHours: 24, lastAt: T0, level: 1, evidence: 1, lapses: 0 };
    const upd = (at: number) =>
      updateMemory(base, { success: true, weight: 1, at, pBefore: 0.5, baselineAfter: () => DEFAULT_PRIOR }, params);
    const massed = upd(T0 + 60_000);
    const spaced = upd(T0 + 3 * DAY);
    expect(spaced?.halfLifeHours).toBeGreaterThan(massed?.halfLifeHours ?? Infinity);
    expect(massed?.halfLifeHours).toBeGreaterThan(24);
  });

  it('ignores zero, negative and non-finite weights', () => {
    const u = { success: true, at: T0, pBefore: 0.1, baselineAfter: () => 0.1 };
    expect(updateMemory(undefined, { ...u, weight: 0 }, params)).toBeUndefined();
    expect(updateMemory(undefined, { ...u, weight: -1 }, params)).toBeUndefined();
    expect(updateMemory(undefined, { ...u, weight: Number.NaN }, params)).toBeUndefined();
    expect(updateMemory(undefined, { ...u, weight: Number.POSITIVE_INFINITY }, params)).toBeUndefined();
  });
});

describe('LearnerModel basics', () => {
  it('returns the prior when there is no evidence', () => {
    const m = new LearnerModel();
    for (const s of SKILLS) expect(m.pKnown('es:casa', s, T0)).toBe(DEFAULT_PRIOR);
    const custom = new LearnerModel({ prior: (k, s) => (k === 'es:hospital' && s === 'meaning' ? 0.6 : 0.01) });
    expect(custom.pKnown('es:hospital', 'meaning', T0)).toBe(0.6);
    expect(custom.pKnown('es:hospital', 'speaking', T0)).toBe(0.01);
    expect([...custom.knownKeys()]).toEqual([]);
  });

  it('clamps a misbehaving prior into [0, 1]', () => {
    const m = new LearnerModel({ prior: (k) => (k === 'a' ? 2 : k === 'b' ? -1 : Number.NaN) });
    expect(m.pKnown('a', 'meaning', T0)).toBe(1);
    expect(m.pKnown('b', 'meaning', T0)).toBe(0);
    expect(m.pKnown('c', 'meaning', T0)).toBe(0);
  });

  it('success raises pKnown for the skills the event touches only', () => {
    const m = new LearnerModel();
    m.apply(ev('heard', 'es:casa', T0));
    expect(m.pKnown('es:casa', 'sound', T0)).toBeGreaterThan(DEFAULT_PRIOR);
    expect(m.pKnown('es:casa', 'meaning', T0)).toBeGreaterThan(DEFAULT_PRIOR);
    expect(m.pKnown('es:casa', 'written', T0)).toBe(DEFAULT_PRIOR);
    expect(m.pKnown('es:casa', 'speaking', T0)).toBe(DEFAULT_PRIOR);
  });

  it('failure lowers pKnown', () => {
    const m = new LearnerModel({ prior: () => 0.9 });
    m.apply(ev('gloss_lookup', 'es:mesa', T0));
    expect(m.pKnown('es:mesa', 'meaning', T0)).toBeLessThan(0.9);
    m.apply(ev('hold_reveal', 'es:mesa', T0));
    expect(m.pKnown('es:mesa', 'sound', T0)).toBeLessThan(0.9);
    // hold_reveal says nothing about the written skill.
    expect(m.pKnown('es:mesa', 'written', T0)).toBe(0.9);
  });

  it('repeated successes approach certainty, repeated failures approach zero', () => {
    const up = new LearnerModel();
    const down = new LearnerModel({ prior: () => 0.9 });
    let prevUp = up.pKnown('es:perro', 'speaking', T0);
    let prevDown = down.pKnown('es:perro', 'speaking', T0);
    for (let i = 0; i < 12; i++) {
      const at = T0 + i * DAY;
      up.apply(cliff('es:perro', at, 'full', 'free'));
      down.apply(ev('native_gap', 'es:perro', at));
      const pu = up.pKnown('es:perro', 'speaking', at);
      const pd = down.pKnown('es:perro', 'speaking', at);
      expect(pu).toBeGreaterThanOrEqual(prevUp);
      expect(pd).toBeLessThanOrEqual(prevDown);
      prevUp = pu;
      prevDown = pd;
    }
    expect(prevUp).toBeGreaterThan(0.9);
    expect(prevDown).toBeLessThan(0.1);
  });

  it('forgets over time', () => {
    const m = new LearnerModel();
    m.apply(cliff('es:ventana', T0, 'full', 'free'));
    const now = m.pKnown('es:ventana', 'speaking', T0);
    const hour = m.pKnown('es:ventana', 'speaking', T0 + H);
    const day = m.pKnown('es:ventana', 'speaking', T0 + DAY);
    const month = m.pKnown('es:ventana', 'speaking', T0 + 30 * DAY);
    const years = m.pKnown('es:ventana', 'speaking', T0 + 3000 * DAY);
    expect(now).toBeGreaterThan(hour);
    expect(hour).toBeGreaterThan(day);
    expect(day).toBeGreaterThan(month);
    expect(month).toBeGreaterThan(years);
    // Fully forgotten after a success-only history, recall has decayed to the baseline,
    // so the item reads as its prior again (never below it).
    expect(years).toBeCloseTo(DEFAULT_PRIOR, 6);
    expect(years).toBeGreaterThanOrEqual(DEFAULT_PRIOR);
  });

  it('a spaced review keeps the word longer than a massed one', () => {
    const spaced = new LearnerModel();
    const massed = new LearnerModel();
    spaced.applyAll([cliff('es:llave', T0, 'full', 'free'), cliff('es:llave', T0 + 2 * DAY, 'full', 'free')]);
    massed.applyAll([cliff('es:llave', T0, 'full', 'free'), cliff('es:llave', T0 + 60_000, 'full', 'free')]);
    const later = T0 + 2 * DAY + 10 * DAY;
    expect(spaced.pKnown('es:llave', 'speaking', later)).toBeGreaterThan(massed.pKnown('es:llave', 'speaking', later));
  });

  it('success-only histories never end below the prior (alg-4)', () => {
    // A cognate heard and read without trouble must not read as less known than an
    // untouched cognate, however much time passes.
    const cognate = new LearnerModel({ prior: (k, s) => (k === 'es:accidente' || k === 'es:hospital' ? (s === 'meaning' ? 0.5 : 0.3) : 0.002) });
    cognate.applyAll([ev('heard', 'es:accidente', T0), ev('read', 'es:accidente', T0)]);
    for (const days of [0, 30, 60, 365, 3000]) {
      expect(cognate.pKnown('es:accidente', 'meaning', T0 + days * DAY), `${days} days`).toBeGreaterThanOrEqual(0.5);
    }
    expect(cognate.pKnown('es:hospital', 'meaning', T0 + 30 * DAY)).toBe(0.5);
    // A placement-known word heard once.
    const placed = new LearnerModel({ prior: () => 0.95 });
    placed.apply(ev('heard', 'es:casa', T0));
    for (const days of [30, 365, 730, 5000]) {
      expect(placed.pKnown('es:casa', 'sound', T0 + days * DAY), `${days} days`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('a form whose lexeme became known later does not end below its inherited baseline (alg-4)', () => {
    const m = new LearnerModel();
    m.apply(ev('read', TUVIERON, T0));
    for (let d = 1; d <= 6; d++) m.apply(cliff(TENER, T0 + d * DAY, 'full', 'free'));
    const later = T0 + 3000 * DAY;
    expect(m.pKnown(TUVIERON, 'meaning', later)).toBeGreaterThanOrEqual(m.baseline(TUVIERON, 'meaning', later) - 1e-12);
  });

  it('failure-only histories still decay as before, below the prior (alg-4)', () => {
    const m = new LearnerModel({ prior: () => 0.5 });
    m.apply(ev('gloss_lookup', 'es:ventana', T0));
    const st = m.memoryOf('es:ventana', 'meaning');
    const c = (st?.evidence ?? 0) / ((st?.evidence ?? 0) + DEFAULT_LEARNER_PARAMS.evidenceHalfWeight);
    expect(m.pKnown('es:ventana', 'meaning', T0 + 3000 * DAY)).toBeCloseTo((1 - c) * 0.5, 6);
  });

  it('a word the prior calls known does not decay below its prior after a success', () => {
    const m = new LearnerModel({ prior: () => 0.9 });
    m.apply(ev('heard', 'es:hola', T0));
    expect(m.pKnown('es:hola', 'sound', T0 + 7 * DAY)).toBeGreaterThan(0.89);
  });

  it('rung changes the strength of a correct cliff answer', () => {
    const at = T0;
    const p = (rung: CliffRung) => {
      const m = new LearnerModel();
      m.apply(cliff('es:mercado', at, 'full', rung));
      return m.pKnown('es:mercado', 'speaking', at);
    };
    expect(p('free')).toBeGreaterThan(p('hint'));
    expect(p('hint')).toBeGreaterThan(p('options'));
    expect(p('options')).toBeGreaterThan(DEFAULT_PRIOR);
  });

  it('no credit is a speaking failure at every rung, and partial is weaker than full', () => {
    for (const rung of ['options', 'hint', 'free'] as const) {
      const m = new LearnerModel({ prior: () => 0.5 });
      m.apply(cliff('es:fruta', T0, 'none', rung));
      expect(m.pKnown('es:fruta', 'speaking', T0)).toBeLessThan(0.5);
      const full = new LearnerModel({ prior: () => 0.5 });
      const partial = new LearnerModel({ prior: () => 0.5 });
      full.apply(cliff('es:fruta', T0, 'full', rung));
      partial.apply(cliff('es:fruta', T0, 'partial', rung));
      expect(full.pKnown('es:fruta', 'speaking', T0)).toBeGreaterThanOrEqual(partial.pKnown('es:fruta', 'speaking', T0));
    }
  });

  it('a success never lowers and a failure never raises pKnown, for any history', () => {
    // Deterministic pseudo-random histories (LCG, no Math.random).
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    const types: LearnerEvent['type'][] = [
      'heard', 'tap_rehear', 'hold_reveal', 'read', 'gloss_lookup', 'cliff_answer',
      'cliff_skip', 'spoke_correct', 'spoke_error', 'native_gap', 'marked_known',
    ];
    const keys = [TENER, TUVIERON, TENGO, 'es:casa'];
    for (let run = 0; run < 30; run++) {
      const prior: PriorFn = (k, s) => ((k.length * 7 + s.length) % 10) / 10;
      const m = new LearnerModel({ prior });
      let at = T0;
      for (let i = 0; i < 40; i++) {
        at += Math.floor(rnd() * 5 * DAY);
        const type = types[Math.floor(rnd() * types.length)] ?? 'heard';
        const key = keys[Math.floor(rnd() * keys.length)] ?? TENER;
        const e: LearnerEvent =
          type === 'cliff_answer'
            ? cliff(key, at, (['full', 'partial', 'none'] as const)[Math.floor(rnd() * 3)] ?? 'full', (['options', 'hint', 'free'] as const)[Math.floor(rnd() * 3)] ?? 'free')
            : ev(type, key, at);
        const evidence = evidenceFor(e);
        const before = new Map(SKILLS.map((s) => [s, m.pKnown(key, s, at)]));
        m.apply(e);
        for (const s of SKILLS) {
          const items = evidence.filter((x) => x.skill === s);
          const after = m.pKnown(key, s, at);
          const b = before.get(s) ?? 0;
          if (items.length && items.every((x) => x.success)) expect(after).toBeGreaterThanOrEqual(b - 1e-12);
          if (items.length && items.every((x) => !x.success)) expect(after).toBeLessThanOrEqual(b + 1e-12);
          expect(after).toBeGreaterThanOrEqual(0);
          expect(after).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('form back-off', () => {
  it('an unseen form inherits most of its lexeme meaning knowledge', () => {
    const m = new LearnerModel();
    for (let i = 0; i < 6; i++) m.apply(cliff(TENER, T0 + i * DAY, 'full', 'free'));
    const now = T0 + 5 * DAY;
    const pLex = m.pKnown(TENER, 'meaning', now);
    const pForm = m.pKnown(TUVIERON, 'meaning', now);
    const share = DEFAULT_LEARNER_PARAMS.formBackoff.meaning;
    expect(pLex).toBeGreaterThan(0.7);
    expect(pForm).toBeCloseTo(share * pLex + (1 - share) * DEFAULT_PRIOR, 12);
    expect(pForm).toBeLessThan(pLex);
    // Sound, written and speaking are form-specific.
    expect(m.pKnown(TUVIERON, 'speaking', now)).toBe(DEFAULT_PRIOR);
    expect(m.pKnown(TUVIERON, 'sound', now)).toBe(DEFAULT_PRIOR);
  });

  it('failures on the form itself cut what it inherits', () => {
    const m = new LearnerModel();
    for (let i = 0; i < 6; i++) m.apply(cliff(TENER, T0 + i * DAY, 'full', 'free'));
    const now = T0 + 5 * DAY;
    const sibling = m.pKnown(TENGO, 'meaning', now);
    const lexBefore = m.pKnown(TENER, 'meaning', now);
    m.apply(ev('gloss_lookup', TUVIERON, now));
    m.apply(ev('gloss_lookup', TUVIERON, now));
    expect(m.pKnown(TUVIERON, 'meaning', now)).toBeLessThan(0.35);
    // The lexeme takes a much smaller hit, and other forms keep most of their inheritance.
    const lexAfter = m.pKnown(TENER, 'meaning', now);
    expect(lexAfter).toBeLessThan(lexBefore);
    expect(lexAfter).toBeGreaterThan(0.6);
    expect(m.pKnown(TENGO, 'meaning', now)).toBeLessThan(sibling);
    expect(m.pKnown(TENGO, 'meaning', now)).toBeGreaterThan(m.pKnown(TUVIERON, 'meaning', now));
  });

  it('meaning evidence on a form also counts for its lexeme', () => {
    const m = new LearnerModel();
    m.apply(ev('spoke_correct', TUVIERON, T0));
    expect(m.pKnown(TENER, 'meaning', T0)).toBeGreaterThan(DEFAULT_PRIOR);
    // Speaking does not back off, so the lexeme gets no speaking evidence.
    expect(m.pKnown(TENER, 'speaking', T0)).toBe(DEFAULT_PRIOR);
    expect(new Set(m.knownKeys())).toEqual(new Set([TUVIERON, TENER]));
    // Understanding one form helps a sibling form through the lexeme.
    expect(m.pKnown(TENGO, 'meaning', T0)).toBeGreaterThan(DEFAULT_PRIOR);
  });

  it('back-off can be turned on for other skills through params', () => {
    const m = new LearnerModel({ params: { formBackoff: { sound: 0.5 } } });
    for (let i = 0; i < 5; i++) m.apply(ev('marked_known', TENER, T0));
    expect(m.params.formBackoff.meaning).toBe(DEFAULT_LEARNER_PARAMS.formBackoff.meaning);
    expect(m.pKnown(TENGO, 'sound', T0)).toBeGreaterThan(DEFAULT_PRIOR);
  });
});

describe('keys and odd input', () => {
  it('treats keys as opaque: accents, missing accents, apostrophes and case are distinct items', () => {
    const m = new LearnerModel();
    const keys = ['es:está', "es:'tá", "es:pa'", 'es:Marta'];
    for (const k of keys) m.apply(cliff(k, T0, 'full', 'free'));
    for (const k of keys) expect(m.pKnown(k, 'speaking', T0)).toBeGreaterThan(0.3);
    expect(m.pKnown('es:esta', 'speaking', T0)).toBe(DEFAULT_PRIOR);
    expect(m.pKnown('es:pa', 'speaking', T0)).toBe(DEFAULT_PRIOR);
    expect(m.pKnown('es:marta', 'speaking', T0)).toBe(DEFAULT_PRIOR);
    expect(new Set(m.knownKeys())).toEqual(new Set(keys));
  });

  it('ignores events with an empty key or a non-finite time', () => {
    const m = new LearnerModel();
    expect(m.apply(ev('heard', '', T0))).toBe(false);
    expect(m.apply(ev('heard', 'es:casa', Number.NaN))).toBe(false);
    expect(m.apply(ev('heard', 'es:casa', Number.POSITIVE_INFINITY))).toBe(false);
    expect([...m.knownKeys()]).toEqual([]);
    expect(m.applyAll([])).toBe(0);
  });

  it('accepts punctuation-only and unknown keys as ordinary opaque items', () => {
    const m = new LearnerModel();
    expect(m.apply(ev('heard', 'es:...', T0))).toBe(true);
    expect(m.pKnown('es:...', 'sound', T0)).toBeGreaterThan(DEFAULT_PRIOR);
    expect(m.pKnown('xx:nunca-visto', 'meaning', T0)).toBe(DEFAULT_PRIOR);
  });

  it('a malformed "#..." key is its own item and never creates an empty-key lexeme', () => {
    const m = new LearnerModel();
    m.apply(ev('spoke_correct', '#number=p', T0));
    expect([...m.knownKeys()]).toEqual(['#number=p']);
    expect(m.pKnown('#number=p', 'meaning', T0)).toBeGreaterThan(DEFAULT_PRIOR);
    expect(() => LearnerModel.restore(JSON.parse(JSON.stringify(m.snapshot())))).not.toThrow();
  });

  it('applyAll orders events by time, so the batch order does not matter', () => {
    const events: LearnerEvent[] = [
      cliff('es:playa', T0 + 3 * DAY, 'full', 'free'),
      ev('gloss_lookup', 'es:playa', T0),
      ev('heard', 'es:playa', T0 + DAY),
      cliff('es:playa', T0 + 2 * DAY, 'none', 'hint'),
    ];
    const a = new LearnerModel();
    const b = new LearnerModel();
    expect(a.applyAll(events)).toBe(4);
    b.applyAll([...events].reverse());
    for (const s of SKILLS) expect(a.pKnown('es:playa', s, T0 + 5 * DAY)).toBe(b.pKnown('es:playa', s, T0 + 5 * DAY));
  });

  it('applies an out-of-order event as if it happened at the latest time', () => {
    const m = new LearnerModel();
    m.apply(cliff('es:noche', T0 + DAY, 'full', 'free'));
    m.apply(cliff('es:noche', T0, 'full', 'free'));
    expect(m.memoryOf('es:noche', 'speaking')?.lastAt).toBe(T0 + DAY);
    // Querying before the latest event reads as "just now".
    expect(m.pKnown('es:noche', 'speaking', T0)).toBe(m.pKnown('es:noche', 'speaking', T0 + DAY));
  });

  it('rejects unusable params', () => {
    expect(() => new LearnerModel({ params: { evidenceHalfWeight: 0 } })).toThrow(RangeError);
    expect(() => new LearnerModel({ params: { levelCap: 1.5 } })).toThrow(RangeError);
    expect(() => new LearnerModel({ params: { minHalfLifeHours: 100, maxHalfLifeHours: 10 } })).toThrow(RangeError);
    expect(() => new LearnerModel({ params: { formBackoff: { meaning: -0.1 } } })).toThrow(RangeError);
    expect(() => new LearnerModel({ params: { successGrowth: 0.5 } })).toThrow(RangeError);
    expect(new LearnerModel({ params: { initialHalfLifeHours: undefined } }).params.initialHalfLifeHours).toBe(24);
  });
});

describe('snapshot', () => {
  function busyModel(prior?: PriorFn): LearnerModel {
    const m = new LearnerModel({ prior });
    m.applyAll([
      ev('heard', TUVIERON, T0),
      ev('tap_rehear', TUVIERON, T0 + 1000),
      cliff(TENGO, T0 + H, 'full', 'hint'),
      ev('gloss_lookup', "es:'tá", T0 + 2 * H),
      ev('marked_known', 'es:hola', T0 + 3 * H),
      ev('spoke_error', 'es:ser', T0 + DAY),
      ev('native_gap', 'es:mercado', T0 + 2 * DAY),
    ]);
    return m;
  }

  it('round-trips through JSON with identical pKnown', () => {
    const prior: PriorFn = (k, s) => (k.includes('hola') ? 0.7 : s === 'meaning' ? 0.05 : 0.01);
    const m = busyModel(prior);
    const json = JSON.stringify(m.snapshot());
    const r = LearnerModel.restore(JSON.parse(json), { prior });
    const keys = [...m.knownKeys(), TENER, 'es:nada'];
    for (const k of keys) {
      for (const s of SKILLS) {
        for (const t of [T0, T0 + DAY, T0 + 40 * DAY]) expect(r.pKnown(k, s, t)).toBe(m.pKnown(k, s, t));
      }
    }
    expect(new Set(r.knownKeys())).toEqual(new Set(m.knownKeys()));
    expect(JSON.stringify(r.snapshot())).toBe(json);
  });

  it('keeps custom params and a custom evidence table', () => {
    const table: EventEvidenceTable = { ...EVENT_EVIDENCE, heard: [{ skill: 'sound', success: true, weight: 1 }] };
    const m = new LearnerModel({ params: { evidenceHalfWeight: 3 }, evidence: table });
    m.apply(ev('heard', 'es:sol', T0));
    const snap = JSON.parse(JSON.stringify(m.snapshot()));
    expect(snap.evidence.heard).toEqual([{ skill: 'sound', success: true, weight: 1 }]);
    const r = LearnerModel.restore(snap);
    expect(r.params.evidenceHalfWeight).toBe(3);
    r.apply(ev('heard', 'es:luna', T0));
    m.apply(ev('heard', 'es:luna', T0));
    expect(r.pKnown('es:luna', 'sound', T0)).toBe(m.pKnown('es:luna', 'sound', T0));
    expect(new LearnerModel().snapshot().evidence).toBeUndefined();
  });

  it('snapshot is sorted and contains only finite numbers', () => {
    const snap = busyModel().snapshot();
    const keys = snap.items.map((i) => i.key);
    expect(keys).toEqual([...keys].sort());
    for (const it of snap.items) for (const v of Object.values(it.state)) expect(Number.isFinite(v)).toBe(true);
  });

  it('rejects malformed snapshots', () => {
    expect(() => LearnerModel.restore({ version: 2 } as never)).toThrow();
    const snap = busyModel().snapshot();
    const bad = JSON.parse(JSON.stringify(snap));
    bad.items[0].state.halfLifeHours = 'x';
    expect(() => LearnerModel.restore(bad)).toThrow();
    const badSkill = JSON.parse(JSON.stringify(snap));
    badSkill.items[0].skill = 'singing';
    expect(() => LearnerModel.restore(badSkill)).toThrow();
  });
});
