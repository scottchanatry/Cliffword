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
import type { ModelFileState } from '../../adapters/model/types';
import { AccountPreview } from './AccountPreview';
import { ModelCard } from './ModelCard';
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

  it('welcome: one line on what Cliffword is and the three steps, drawn with a line of the first experience', async () => {
    await renderWithProviders(<AccountPreview name="onboarding-welcome" />);
    expect(screen.getByText('Learn Spanish with short, funny stories.')).toBeOnTheScreen();
    expect(screen.getByText('Listen')).toBeOnTheScreen();
    expect(screen.getByText('Fill the gap')).toBeOnTheScreen();
    expect(screen.getByText('Hear how you did')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Get started' })).toBeOnTheScreen();
  });

  it('picker: six experiences, the five without episodes coming soon and closed', async () => {
    await renderWithProviders(<AccountPreview name="onboarding-experience" />);
    expect(screen.getAllByTestId(/^experience-en-es\.track\.[a-z]+$/)).toHaveLength(6);
    expect(screen.getAllByText('Coming soon')).toHaveLength(5);
    expect(screen.getByTestId('experience-en-es.track.living')).not.toBeDisabled();
    expect(screen.getByTestId('experience-en-es.track.food')).toBeDisabled();
  });

  it('level and address: one tap answers; the address shows a line said to a man and to a woman', async () => {
    await renderWithProviders(<AccountPreview name="onboarding-level" />);
    expect(screen.getByRole('radio', { name: /^Brand new/ })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: /^A little/ })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: /^Comfortable/ })).toBeOnTheScreen();
    await renderWithProviders(<AccountPreview name="onboarding-address" />);
    expect(screen.getByRole('radio', { name: /^As a man\. .*vecino/ })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: /^As a woman\. .*vecina/ }).props.accessibilityState?.checked).toBe(true);
  });

  it('microphone: why, Allow and Type instead; after a refusal, Settings and typing; the model line', async () => {
    await renderWithProviders(<AccountPreview name="onboarding-mic" />);
    expect(screen.getByRole('button', { name: 'Allow microphone' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Type instead' })).toBeOnTheScreen();
    expect(screen.getByTestId('model-note')).toHaveTextContent('A language model (1.1 GB) downloads by itself on Wi-Fi. It checks what you say, so any natural answer counts.');
    await renderWithProviders(<AccountPreview name="onboarding-mic-denied" />);
    expect(screen.queryByRole('button', { name: 'Allow microphone' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
    expect(screen.getByTestId('mic-status')).toHaveTextContent(/off for Cliffword/);
  });

  it('model card: a failed size check shows what it saw, in small print', async () => {
    const bytes = 1_107_409_472;
    const file: ModelFileState = {
      status: 'error',
      progress: { bytesWritten: 0, bytesTotal: bytes, fraction: 0 },
      error: 'size-mismatch',
      detail: { check: 'final', expectedBytes: bytes, actualBytes: 0, reportedTotalBytes: bytes, bytesWrittenAtFail: bytes, seconds: 312 },
    };
    const none = () => {};
    const line = 'Details: final check, 0 of 1,107,409,472 bytes after 312 s (last reported total 1,107,409,472, 1,107,409,472 received).';
    await renderWithProviders(
      <ModelCard file={file} availability="download-failed" descriptor={{ bytes }} freeBytes={null} onStart={none} onPause={none} onDelete={none} />,
    );
    expect(screen.getByTestId('model-error-detail')).toHaveTextContent(line);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();

    const { detail: _detail, ...withoutDetail } = file;
    await renderWithProviders(
      <ModelCard file={withoutDetail} availability="download-failed" descriptor={{ bytes }} freeBytes={null} onStart={none} onPause={none} onDelete={none} />,
    );
    expect(screen.queryByTestId('model-error-detail')).toBeNull();
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

  it('settings: the experience, the address and the level; no music rows; the confirm sheet asks first', async () => {
    await renderWithProviders(<AccountPreview name="settings" />);
    expect(screen.getByTestId('settings-experience-title')).toHaveTextContent('Living in San Juan');
    expect(screen.getByRole('radio', { name: 'As a woman' }).props.accessibilityState?.checked).toBe(true);
    await fireEvent.press(screen.getByRole('radio', { name: 'As a man' }));
    expect(screen.getByRole('radio', { name: 'As a man' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByRole('radio', { name: '1' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByText(/^Level 1: hear it, then pick the word/)).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'On-device recognition only' }).props.accessibilityState?.checked).toBe(true);
    // Music is off: no explicit lyrics, Apple Music or lyrics rows.
    expect(screen.queryByRole('switch', { name: 'Explicit lyrics' })).toBeNull();
    expect(screen.queryByTestId('settings-apple-music')).toBeNull();
    expect(screen.queryByTestId('settings-delete-content')).toBeNull();
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
