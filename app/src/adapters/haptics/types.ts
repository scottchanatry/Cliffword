/**
 * A thin haptics wrapper: the app names the moment, the adapter picks the feedback.
 * Fire and forget; failures are swallowed (haptics are never essential).
 *
 * Implementations: ExpoHapticsAdapter (expo-haptics; vibration or nothing on web) and
 * FakeHaptics (records what was played).
 */
export type HapticKind =
  /** A light tap: hold-to-speak begins, a tile is tapped. */
  | 'tap'
  /** A selection changed: a pill, an option rung. */
  | 'selection'
  /** A cliff answer landed. */
  | 'success'
  /** A soft hint. */
  | 'warning'
  /** Something failed (no speech heard, permission refused). */
  | 'error';

export interface Haptics {
  play(kind: HapticKind): void;
}
