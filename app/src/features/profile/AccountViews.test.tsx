/**
 * Every onboarding, profile and settings fixture renders with named controls of at least 44 dp,
 * and each state shows what it should (the views take plain props; the routes are tested in
 * __tests__/routes/onboarding.test.tsx and profile.test.tsx).
 */
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderWithProviders as renderInProviders } from '../../testing/renderWithProviders';
import { layout } from '../../theme';
import { ACCOUNT_FIXTURE_NAMES, isAccountFixtureName } from './accountFixtures';
import { AccountPreview } from './AccountPreview';
import { RATE_STEP, ratePercent, stepRate } from './RateStepper';

/** A 390 x 844 phone; the voice step holds anywhere, so its gesture detector needs the gesture root. */
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWithProviders = (ui: ReactElement) =>
  renderInProviders(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GestureHandlerRootView style={styles.root}>{ui}</GestureHandlerRootView>
    </SafeAreaProvider>,
  );
const styles = StyleSheet.create({ root: { flex: 1 } });

function expectAccessibleControls() {
  const roles = ['button', 'togglebutton', 'link', 'radio', 'switch'] as const;
  const controls = roles.flatMap((role) => screen.queryAllByRole(role));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({ testID: control.props.testID, named: true });
    const style = StyleSheet.flatten(control.props.style) ?? {};
    const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, name, height: height >= layout.minTouch }).toEqual({ testID: control.props.testID, name, height: true });
  }
}

describe('account views', () => {
  it.each(ACCOUNT_FIXTURE_NAMES)('%s renders with named 44 dp controls', async (name) => {
    await renderWithProviders(<AccountPreview name={name} />);
    expect(screen.getByTestId('account-preview')).toBeOnTheScreen();
    expectAccessibleControls();
  });

  it('knows its fixture names', () => {
    expect(isAccountFixtureName('settings')).toBe(true);
    expect(isAccountFixtureName('main')).toBe(false);
  });

  it('model step: download offer, progress with "Continue while it downloads", and a space error', async () => {
    await renderWithProviders(<AccountPreview name="onboarding-model" />);
    expect(screen.getByRole('button', { name: 'Download (1.1 GB)' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeOnTheScreen();
    expect(screen.getByTestId('model-free-space')).toHaveTextContent(/^23\.4 GB free on this phone/);

    await renderWithProviders(<AccountPreview name="onboarding-model-downloading" />);
    expect(screen.getByText('Downloading… 42%')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
    expect(screen.getByRole('button', { name: 'Continue while it downloads' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pause download' })).toBeOnTheScreen();

    await renderWithProviders(<AccountPreview name="onboarding-model-error" />);
    expect(screen.getByTestId('model-status-line')).toHaveTextContent(/Not enough free space\. The model needs 1\.7 GB free and this phone has 900 MB/);
    expect(screen.getByRole('button', { name: 'Continue without it' })).toBeOnTheScreen();
  });

  it('voice step: hold practice when speech is ready; Settings and typing when refused', async () => {
    await renderWithProviders(<AccountPreview name="onboarding-voice" />);
    expect(screen.getByTestId('practice-hold')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Otra vez, again. Done' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '¿Qué significa?, meaning' })).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^practice-(again|slower|dont_know|next|done|meaning)$/)).toHaveLength(6);
    expect(screen.getByRole('radio', { name: 'Paulina' }).props.accessibilityState?.checked).toBe(true);

    await renderWithProviders(<AccountPreview name="onboarding-voice-denied" />);
    expect(screen.queryByTestId('practice-hold')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Type instead' })).toBeOnTheScreen();
  });

  it('slang step: registers as radios, Puerto Rico selected, explicit on with its note', async () => {
    await renderWithProviders(<AccountPreview name="onboarding-slang" />);
    expect(screen.getByRole('radio', { name: 'Neutral · works anywhere' }).props.accessibilityState?.checked).toBe(true);
    await fireEvent.press(screen.getByRole('radio', { name: 'Street · with friends' }));
    expect(screen.getByRole('radio', { name: 'Street · with friends' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByRole('togglebutton', { name: 'Puerto Rico' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId('explicit-note')).toHaveTextContent(/^On by default/);
  });

  it('profile: the minutes are the first heading; a new learner gets an early skill hint', async () => {
    await renderWithProviders(<AccountPreview name="profile" />);
    expect(screen.getByTestId('minutes-today')).toHaveTextContent('5:03');
    expect(screen.getByTestId('minutes-total')).toHaveTextContent('125:12');
    expect(screen.getByTestId('streak')).toHaveTextContent('4 days');
    expect(screen.getByTestId('skill-hint')).toHaveTextContent(/You understand more than you say/);
    expect(screen.getAllByTestId(/^week-bar-/)).toHaveLength(7);

    await renderWithProviders(<AccountPreview name="profile-new" />);
    expect(screen.getByTestId('minutes-today')).toHaveTextContent('0:00');
    expect(screen.getByTestId('streak')).toHaveTextContent('0 days');
    expect(screen.getByTestId('skill-hint')).toHaveTextContent('Your mix shows up after a few stories.');
  });

  it('settings: switches and radios show their state; the confirm sheet asks first', async () => {
    await renderWithProviders(<AccountPreview name="settings" />);
    expect(screen.getByRole('switch', { name: 'Explicit lyrics' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByRole('switch', { name: 'On-device recognition only' }).props.accessibilityState?.checked).toBe(true);
    await fireEvent.press(screen.getByRole('switch', { name: 'Explicit lyrics' }));
    expect(screen.getByRole('switch', { name: 'Explicit lyrics' }).props.accessibilityState?.checked).toBe(false);
    expect(screen.getByTestId('settings-apple-music-hint')).toHaveTextContent(/^Connected/);
    expect(screen.getByText('Privacy')).toBeOnTheScreen();
    expect(screen.getByText('No account, no analytics, no ads.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Reset progress' }));
    expect(screen.getByText('Reset your progress?')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('confirm-sheet-cancel'));
    expect(screen.queryByText('Reset your progress?')).toBeNull();
  });

  it('self-test: the native path passes; the mock model only reports', async () => {
    await renderWithProviders(<AccountPreview name="selftest" />);
    expect(screen.getByTestId('selftest-scoring')).toHaveTextContent('Native method (exact)');
    expect(screen.getByTestId('selftest-verdict-title')).toHaveTextContent('Passed: 14 of 14 totals within 0.15 nats.');
    await renderWithProviders(<AccountPreview name="selftest-mock" />);
    expect(screen.getByTestId('selftest-verdict-title')).toHaveTextContent(/^Mock model/);
  });

  it('steps the speech rate by 10 % between 50 % and 150 %', () => {
    expect(RATE_STEP).toBe(0.1);
    expect(stepRate(0, 1)).toBe(0.1);
    expect(stepRate(0.1, -1)).toBe(0);
    expect(stepRate(0.5, 1)).toBe(0.5);
    expect(stepRate(-0.5, -1)).toBe(-0.5);
    expect(stepRate(0.25, 1)).toBe(0.4);
    expect(ratePercent(-0.3)).toBe(70);
  });
});
