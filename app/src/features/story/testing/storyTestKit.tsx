/**
 * Test kit for the story views (tests only): jest.fn() actions for every StoryAction, the
 * fixtures built once per test file, and a render that wraps StoryView in the gesture root
 * and the app providers.
 */
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { StoryActions, StoryViewModel } from '../../../session/contract';
import { defaultPacks, sharedMockModel } from '../../../services/defaults';
import { renderWithProviders } from '../../../testing/renderWithProviders';
import { storyFixtures, type StoryFixtures } from '../fixtures';
import { StoryView } from '../StoryView';

export type MockStoryActions = { [K in keyof StoryActions]-?: jest.Mock };

export function mockStoryActions(): MockStoryActions {
  const names: (keyof StoryActions)[] = [
    'holdBegin',
    'holdStart',
    'holdEnd',
    'holdCancel',
    'typeAnswer',
    'command',
    'pickOption',
    'closeMeaning',
    'dismissNotice',
    'start',
    'next',
    'hearWord',
    'revealWord',
    'replay',
    'setTextMode',
    'startRegisterTask',
    'reportSentence',
    'openEpisode',
    'closeEpisode',
    'replayEpisode',
    'micTap',
  ];
  return Object.fromEntries(names.map((n) => [n, jest.fn()])) as MockStoryActions;
}

export function loadFixtures(): Promise<StoryFixtures> {
  const { lang, pair } = defaultPacks();
  return storyFixtures({ lang, pair, model: sharedMockModel() });
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export async function renderStory(vm: StoryViewModel, actions: MockStoryActions = mockStoryActions()) {
  const result = await renderWithProviders(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StoryView vm={vm} actions={actions} />
      </GestureHandlerRootView>
    </SafeAreaProvider>,
  );
  return { ...result, actions };
}
