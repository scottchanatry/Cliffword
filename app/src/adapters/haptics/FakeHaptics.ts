import type { HapticKind, Haptics } from './types';

/** Records every haptic played, in order. */
export class FakeHaptics implements Haptics {
  readonly played: HapticKind[] = [];

  play(kind: HapticKind): void {
    this.played.push(kind);
  }
}
