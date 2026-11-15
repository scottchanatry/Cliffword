/**
 * ModelAdapter over the engine's deterministic n-gram mock (createMockModel). It needs no file,
 * so it starts 'ready'; load() ignores the path. Used on web, in tests, and on a device while
 * the real model downloads.
 *
 * It keeps the real lifecycle contract so code written against it works with the llama.rn
 * adapter: model calls reject with ModelNotReadyError unless 'ready', and status changes are
 * reported in order (load: 'loading' then 'ready'; unload: 'unloaded').
 */
import { createMockModel, type GenerateOptions, type LanguageModel, type TokenCandidate, type TokenScore } from '@cliffword/engine';
import { Listeners, type Unsubscribe } from '../listeners';
import { ModelNotReadyError, type ModelAdapter, type ModelInfo, type ModelLoadOptions, type ModelStatus } from './types';

/** Nominal context size the mock reports; the n-gram mock has no real limit. */
export const MOCK_CONTEXT_SIZE = 4096;

export interface MockModelAdapterOptions {
  /** The model to wrap. Defaults to createMockModel(). */
  model?: LanguageModel;
  /** Starting status. Defaults to 'ready' (the mock needs no file). */
  status?: Extract<ModelStatus, 'ready' | 'unloaded'>;
}

export class MockModelAdapter implements ModelAdapter {
  readonly id: string;
  private readonly model: LanguageModel;
  private current: ModelStatus;
  private contextSize = MOCK_CONTEXT_SIZE;
  private error: Error | null = null;
  private pendingLoadError: Error | null = null;
  private readonly statusListeners = new Listeners<ModelStatus>();

  constructor(opts: MockModelAdapterOptions = {}) {
    this.model = opts.model ?? createMockModel();
    this.id = this.model.id;
    this.current = opts.status ?? 'ready';
  }

  get status(): ModelStatus {
    return this.current;
  }

  get info(): ModelInfo {
    return { id: this.id, contextSize: this.contextSize, backend: 'mock' };
  }

  get lastError(): Error | null {
    return this.error;
  }

  async load(_modelPath: string, opts: ModelLoadOptions = {}): Promise<void> {
    this.setStatus('loading');
    // Let listeners see 'loading' before the load settles, as with a real model.
    await Promise.resolve();
    const failure = this.pendingLoadError;
    this.pendingLoadError = null;
    if (failure) {
      this.error = failure;
      this.setStatus('error');
      throw failure;
    }
    this.error = null;
    this.contextSize = opts.contextSize ?? MOCK_CONTEXT_SIZE;
    this.setStatus('ready');
  }

  async unload(): Promise<void> {
    this.setStatus('unloaded');
  }

  onStatusChange(listener: (status: ModelStatus) => void): Unsubscribe {
    return this.statusListeners.add(listener);
  }

  /** Test control: the next load() fails with `error`. */
  failNextLoad(error: Error): void {
    this.pendingLoadError = error;
  }

  async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    this.assertReady();
    return this.model.scoreContinuation(context, text);
  }

  async nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    this.assertReady();
    return this.model.nextTokens(context, k);
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    this.assertReady();
    return this.model.generate(prompt, opts);
  }

  private assertReady(): void {
    if (this.current !== 'ready') throw new ModelNotReadyError(this.current);
  }

  private setStatus(status: ModelStatus): void {
    if (status === this.current) return;
    this.current = status;
    this.statusListeners.emit(status);
  }
}
