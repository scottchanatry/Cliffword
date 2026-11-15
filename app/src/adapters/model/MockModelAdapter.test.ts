import { createMockModel, totalLogprob } from '@cliffword/engine';
import { MOCK_CONTEXT_SIZE, MockModelAdapter } from './MockModelAdapter';
import { ModelNotReadyError, type ModelStatus } from './types';

describe('MockModelAdapter', () => {
  const engineMock = createMockModel();

  it('starts ready and answers exactly like the engine mock', async () => {
    const model = new MockModelAdapter({ model: engineMock });
    expect(model.status).toBe('ready');
    expect(model.id).toBe(engineMock.id);
    expect(model.info).toEqual({ id: engineMock.id, contextSize: MOCK_CONTEXT_SIZE, backend: 'mock' });

    const context = 'Frase en español:\nMarta llegó tarde al';
    const tokens = await model.scoreContinuation(context, ' mercado');
    expect(tokens).toEqual(await engineMock.scoreContinuation(context, ' mercado'));
    expect(tokens.map((t) => t.text).join('')).toBe(' mercado');
    expect(Number.isFinite(totalLogprob(tokens))).toBe(true);

    expect(await model.nextTokens(context, 3)).toEqual(await engineMock.nextTokens(context, 3));
    const opts = { n: 2, maxTokens: 8, temperature: 0.8, seed: 7 };
    expect(await model.generate('Marta', opts)).toEqual(await engineMock.generate('Marta', opts));
  });

  it('wraps a fresh createMockModel() by default', async () => {
    const model = new MockModelAdapter();
    expect(model.id).toBe('mock-ngram-es');
    expect((await model.nextTokens('Marta llegó', 2)).length).toBe(2);
  });

  it('reports loading then ready on load, and unloaded on unload', async () => {
    const model = new MockModelAdapter({ status: 'unloaded' });
    const seen: ModelStatus[] = [];
    model.onStatusChange((s) => seen.push(s));

    await expect(model.nextTokens('Marta', 1)).rejects.toBeInstanceOf(ModelNotReadyError);
    await model.load('memory://models/x.gguf', { contextSize: 2048 });
    expect(model.status).toBe('ready');
    expect(model.info.contextSize).toBe(2048);
    await model.unload();
    expect(seen).toEqual(['loading', 'ready', 'unloaded']);
    await expect(model.scoreContinuation('', 'Hola')).rejects.toMatchObject({ status: 'unloaded' });
    await expect(model.generate('', { n: 1, maxTokens: 1, temperature: 0 })).rejects.toBeInstanceOf(ModelNotReadyError);
  });

  it('moves to error when a load fails, and recovers on the next load', async () => {
    const model = new MockModelAdapter();
    const failure = new Error('bad file');
    model.failNextLoad(failure);
    await expect(model.load('memory://broken')).rejects.toBe(failure);
    expect(model.status).toBe('error');
    expect(model.lastError).toBe(failure);
    await expect(model.nextTokens('Marta', 1)).rejects.toBeInstanceOf(ModelNotReadyError);

    await model.load('memory://ok');
    expect(model.status).toBe('ready');
    expect(model.lastError).toBeNull();
  });
});
