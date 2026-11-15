import { ImpactFeedbackStyle, NotificationFeedbackType } from 'expo-haptics';
import { ExpoHapticsAdapter, type ExpoHapticsModule } from './ExpoHapticsAdapter';
import { FakeHaptics } from './FakeHaptics';

describe('FakeHaptics', () => {
  it('records what was played', () => {
    const haptics = new FakeHaptics();
    haptics.play('tap');
    haptics.play('success');
    expect(haptics.played).toEqual(['tap', 'success']);
  });
});

describe('ExpoHapticsAdapter', () => {
  function scripted(): ExpoHapticsModule & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      impactAsync: async (style) => {
        calls.push(`impact:${style}`);
      },
      selectionAsync: async () => {
        calls.push('selection');
      },
      notificationAsync: async (type) => {
        calls.push(`notification:${type}`);
      },
    };
  }

  it('maps each moment to expo-haptics feedback', () => {
    const module = scripted();
    const haptics = new ExpoHapticsAdapter(module);
    for (const kind of ['tap', 'selection', 'success', 'warning', 'error'] as const) haptics.play(kind);
    expect(module.calls).toEqual([
      `impact:${ImpactFeedbackStyle.Light}`,
      'selection',
      `notification:${NotificationFeedbackType.Success}`,
      `notification:${NotificationFeedbackType.Warning}`,
      `notification:${NotificationFeedbackType.Error}`,
    ]);
  });

  it('swallows failures, thrown or rejected', async () => {
    const throwing: ExpoHapticsModule = {
      impactAsync: () => {
        throw new Error('no engine');
      },
      selectionAsync: () => Promise.reject(new Error('no engine')),
      notificationAsync: () => Promise.reject(new Error('no engine')),
    };
    const haptics = new ExpoHapticsAdapter(throwing);
    expect(() => haptics.play('tap')).not.toThrow();
    expect(() => haptics.play('selection')).not.toThrow();
    await Promise.resolve();
  });

  it('uses expo-haptics itself by default (mocked natively in Jest)', () => {
    expect(() => new ExpoHapticsAdapter().play('tap')).not.toThrow();
  });
});
