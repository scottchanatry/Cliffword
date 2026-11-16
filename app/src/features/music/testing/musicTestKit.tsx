/**
 * Test kit for the Music views (tests only): jest.fn() actions for every LyricAction, the
 * fixtures built once per test file, and renders that wrap the views in the gesture root, the
 * safe area and the app providers.
 */
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { screen, within } from '@testing-library/react-native';
import type { LyricActions, LyricViewModel } from '../../../session/contract';
import { defaultPacks, sharedMockModel } from '../../../services/defaults';
import { renderWithProviders } from '../../../testing/renderWithProviders';
import { layout } from '../../../theme';
import { musicFixtures, type MusicFixtures } from '../fixtures';
import { SongView } from '../SongView';
import type { SongPageNav } from '../types';

export type MockLyricActions = { [K in keyof Required<LyricActions>]: jest.Mock };

export function mockLyricActions(): MockLyricActions {
  const names: (keyof Required<LyricActions>)[] = [
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
    'openLine',
    'startEcho',
    'setRegister',
    'showSong',
    'markLine',
    'play',
    'pause',
    'setShowExplicit',
    'hearWord',
  ];
  return Object.fromEntries(names.map((n) => [n, jest.fn()])) as MockLyricActions;
}

let cached: Promise<MusicFixtures> | null = null;

export function loadMusicFixtures(): Promise<MusicFixtures> {
  const { lang, pair } = defaultPacks();
  cached ??= musicFixtures({ lang, pair, model: sharedMockModel() });
  return cached;
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export async function renderMusic(ui: ReactElement) {
  return renderWithProviders(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GestureHandlerRootView style={{ flex: 1 }}>{ui}</GestureHandlerRootView>
    </SafeAreaProvider>,
  );
}

export async function renderSong(vm: LyricViewModel, actions: Partial<MockLyricActions> | MockLyricActions = mockLyricActions(), nav?: SongPageNav) {
  const result = await renderMusic(<SongView vm={vm} actions={actions as LyricActions} nav={nav} />);
  return { ...result, actions };
}

export const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/** Every button, toggle and link has a name and a 44 dp target (the route tests' rule). Returns how many there are. */
export function expectAccessibleControls(): number {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('togglebutton'), ...screen.queryAllByRole('link')];
  for (const control of controls) {
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({ testID: control.props.testID, named: true });
    const style = flat(control.props.style);
    const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, height: height >= layout.minTouch }).toEqual({ testID: control.props.testID, height: true });
  }
  return controls.length;
}
