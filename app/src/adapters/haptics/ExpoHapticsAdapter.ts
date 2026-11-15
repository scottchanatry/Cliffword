import * as ExpoHaptics from 'expo-haptics';
import type { HapticKind, Haptics } from './types';

/** The part of expo-haptics this adapter uses (injectable for tests). */
export interface ExpoHapticsModule {
  impactAsync(style?: ExpoHaptics.ImpactFeedbackStyle): Promise<void>;
  selectionAsync(): Promise<void>;
  notificationAsync(type?: ExpoHaptics.NotificationFeedbackType): Promise<void>;
}

export class ExpoHapticsAdapter implements Haptics {
  constructor(private readonly haptics: ExpoHapticsModule = ExpoHaptics) {}

  play(kind: HapticKind): void {
    let pending: Promise<void>;
    try {
      pending = this.trigger(kind);
    } catch {
      return;
    }
    pending.catch(() => undefined);
  }

  private trigger(kind: HapticKind): Promise<void> {
    switch (kind) {
      case 'tap':
        return this.haptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light);
      case 'selection':
        return this.haptics.selectionAsync();
      case 'success':
        return this.haptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success);
      case 'warning':
        return this.haptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning);
      case 'error':
        return this.haptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error);
    }
  }
}
