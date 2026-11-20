import { FakeClock } from '../clock/FakeClock';
import type { Clock } from '../clock/types';
import type { PhotoPicker, PhotoResult, PhotoSource } from './types';

/** What the next pick does: 'taken' stores a photo; the others are the learner's or the system's answer. */
export type FakePhotoOutcome = 'taken' | 'cancelled' | 'denied' | 'error';

export interface FakePhotoPickerOptions {
  clock?: Clock;
  /** Default ['camera', 'library']. */
  sources?: readonly PhotoSource[];
  /** Where stored photos go. Default 'file:///fake/documents/avatar/'. */
  folder?: string;
}

/**
 * A PhotoPicker for tests: each pick() takes the next scripted outcome ('taken' when none is
 * scripted), and stored photos are kept in an in-memory set, so a test can delete one (a restore
 * without the file) and see locate() return null.
 *
 *   const photos = new FakePhotoPicker();
 *   photos.script('denied', 'taken');
 *   await photos.pick('camera');   // { kind: 'denied', source: 'camera' }
 *   await photos.pick('camera');   // { kind: 'picked', uri: 'file:///fake/documents/avatar/1.jpg' }
 */
export class FakePhotoPicker implements PhotoPicker {
  readonly sources: readonly PhotoSource[];
  /** Every pick, in order. */
  readonly picks: PhotoSource[] = [];
  /** Every removed uri, in order. */
  readonly removed: string[] = [];
  private readonly clock: Clock;
  private readonly folder: string;
  private readonly files = new Set<string>();
  private readonly queue: FakePhotoOutcome[] = [];
  private count = 0;
  private gate: Promise<void> | null = null;

  constructor(opts: FakePhotoPickerOptions = {}) {
    this.clock = opts.clock ?? new FakeClock();
    this.sources = opts.sources ?? ['camera', 'library'];
    this.folder = opts.folder ?? 'file:///fake/documents/avatar/';
  }

  /** The outcomes of the next picks, in order. */
  script(...outcomes: FakePhotoOutcome[]): void {
    this.queue.push(...outcomes);
  }

  /** Holds every pick until the returned function is called (a camera that is still open). */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.gate = null;
      release();
    };
  }

  async pick(source: PhotoSource): Promise<PhotoResult> {
    this.picks.push(source);
    if (this.gate) await this.gate;
    if (!this.sources.includes(source)) return { kind: 'unavailable', source };
    const outcome = this.queue.shift() ?? 'taken';
    switch (outcome) {
      case 'cancelled':
        return { kind: 'cancelled' };
      case 'denied':
        return { kind: 'denied', source };
      case 'error':
        return { kind: 'error', source, message: 'The fake camera failed' };
      case 'taken': {
        this.count += 1;
        const uri = `${this.folder}${this.clock.now()}-${this.count}.jpg`;
        this.files.add(uri);
        return { kind: 'picked', uri };
      }
    }
  }

  async locate(uri: string): Promise<string | null> {
    return this.files.has(uri) ? uri : null;
  }

  async remove(uri: string): Promise<void> {
    this.removed.push(uri);
    this.files.delete(uri);
  }

  /** Stores a photo as if an earlier pick had (a test that starts with one). */
  store(uri = `${this.folder}stored.jpg`): string {
    this.files.add(uri);
    return uri;
  }

  /** Deletes a stored photo behind the app's back (a restore or a reinstall). */
  lose(uri: string): void {
    this.files.delete(uri);
  }

  /** The stored photos, sorted. */
  stored(): string[] {
    return [...this.files].sort();
  }
}
