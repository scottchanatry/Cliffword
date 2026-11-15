import { describe, expect, it } from 'vitest';
import { runLanguageModelContract, type ContractCase } from './contract';
import { createMockModel } from './mock';
import { TopNBoundedModel } from './topN';

// Contexts and continuations the mock corpus knows, scored the way the engine scores
// them: a continuation starts with a space after a word, long words split in two pieces.
const MOCK_CASES: ContractCase[] = [
  { context: 'Marta llegó tarde al', text: ' mercado.' },
  { context: 'Estoy', text: ' muy cansado.' },
  { context: '', text: 'Ella está en el mercado.' },
  { context: 'Ayer fui a la', text: ' playa con mis amigos.' },
];

// The mock gives the same number through both calls, so agreement can be exact.
runLanguageModelContract('mock', () => createMockModel(), {
  cases: MOCK_CASES,
  tolerance: 1e-6,
  generate: { prompt: 'Marta', stop: ['.'] },
});

// The top-N wrapper must keep the contract: bounded tokens only raise logprobs, and
// a candidate from the top of the list is always exact.
runLanguageModelContract('TopNBoundedModel(mock)', () => new TopNBoundedModel(createMockModel()), {
  cases: MOCK_CASES,
  tolerance: 1e-6,
  generate: { prompt: 'Marta', stop: ['.'] },
});

runLanguageModelContract('TopNBoundedModel(mock, n = 1)', () => new TopNBoundedModel(createMockModel(), { n: 1 }), {
  cases: MOCK_CASES,
  tolerance: 1e-6,
  generate: { prompt: 'Marta', stop: ['.'] },
});

describe('runLanguageModelContract', () => {
  it('needs at least one case', () => {
    expect(() => runLanguageModelContract('empty', () => createMockModel(), { cases: [] })).toThrow(/at least one case/);
  });
});
