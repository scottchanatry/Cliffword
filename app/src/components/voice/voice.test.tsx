import { StyleSheet } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { layout } from '../../theme';
import { CommandChips } from './CommandChips';
import { HoldButton } from './HoldButton';
import { ListeningRings } from './ListeningRings';

const mockReduceMotion = jest.fn(() => false);
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return { __esModule: true, ...actual, default: actual.default, useReducedMotion: () => mockReduceMotion() };
});

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

describe('CommandChips', () => {
  it('shows what to say and what it means, and sends the command', async () => {
    const onCommand = jest.fn();
    await renderWithProviders(<CommandChips commands={['again', 'meaning', 'next']} onCommand={onCommand} />);
    expect(screen.getByText('Or just say')).toBeOnTheScreen();
    expect(screen.getByText('¿Qué significa?')).toBeOnTheScreen();
    expect(screen.getByText('meaning')).toBeOnTheScreen();
    const next = screen.getByRole('button', { name: 'Siguiente, next' });
    expect(flat(next.props.style).minHeight).toBeGreaterThanOrEqual(layout.minTouch);
    await fireEvent.press(next);
    expect(onCommand).toHaveBeenCalledWith('next');
  });
});

describe('HoldButton', () => {
  it('toggles listening through the screen-reader action, and reminds a quick tap to hold', async () => {
    const onToggle = jest.fn();
    await renderWithProviders(<HoldButton label="Hold to speak" listen={{ phase: 'idle' }} onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Hold to speak' });
    await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onToggle).toHaveBeenCalledTimes(1);
    await fireEvent.press(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Press and hold while you say your answer, then let go.')).toBeOnTheScreen();
  });

  it('turns into "Stop listening" while listening', async () => {
    await renderWithProviders(<HoldButton label="Hold to speak" listen={{ phase: 'listening', level: 0.4, partial: '' }} onToggle={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeOnTheScreen();
    expect(screen.getByText('Listening…')).toBeOnTheScreen();
  });
});

describe('ListeningRings', () => {
  const ringScale = (i: number) => {
    const ring = screen.getByTestId(`listening-ring-${i}`, { includeHiddenElements: true });
    const animated = (ring.props.jestAnimatedStyle as { value?: { transform?: { scale: number }[] } } | undefined)?.value;
    return animated?.transform?.[0]?.scale ?? 1;
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    mockReduceMotion.mockReturnValue(false);
  });

  it('swell with the microphone level while listening', async () => {
    await renderWithProviders(<ListeningRings level={1} active />);
    jest.advanceTimersByTime(300);
    expect(ringScale(2)).toBeGreaterThan(1.1);
    expect(ringScale(0)).toBeLessThan(ringScale(2));
  });

  it('stay still at rest and with Reduce Motion on', async () => {
    const { unmount } = await renderWithProviders(<ListeningRings level={1} active={false} />);
    jest.advanceTimersByTime(300);
    expect(ringScale(2)).toBe(1);
    await unmount();
    mockReduceMotion.mockReturnValue(true);
    await renderWithProviders(<ListeningRings level={1} active />);
    jest.advanceTimersByTime(300);
    expect(ringScale(2)).toBe(1);
  });
});
