/**
 * The header's corner button shows the learner's picture: the waving character by default, the
 * character they chose, or their photo as a circle. It stays a named 44 pt button that opens the
 * profile. (__tests__/flows/appFlows.test.tsx checks it in the real header.)
 */
import { StyleSheet } from 'react-native';
import { screen } from '@testing-library/react-native';
import { YOU_AVATARS } from '../illustrations';
import { renderWithProviders } from '../testing/renderWithProviders';
import { layout } from '../theme';
import { ProfileButton } from './ProfileButton';

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
const avatar = () => screen.getByTestId('profile-button-avatar', { includeHiddenElements: true });

describe('ProfileButton', () => {
  it('is a named 44 pt button with the default character until the learner chooses', async () => {
    await renderWithProviders(<ProfileButton />);
    const button = screen.getByRole('button', { name: 'Open profile and settings' });
    expect(flat(button.props.style)).toMatchObject({ width: layout.minTouch, height: layout.minTouch });
    expect(avatar().props.source).toBe(YOU_AVATARS.you);
    // Decorative: the button's name says what it does.
    expect(avatar().props.accessible).toBe(false);
  });

  it('shows the character the learner chose', async () => {
    await renderWithProviders(<ProfileButton picture={{ kind: 'character', id: 'you-photographer' }} />);
    expect(avatar().props.source).toBe(YOU_AVATARS['you-photographer']);
  });

  it('shows the learner photo as a circle', async () => {
    const uri = 'file:///docs/avatar/1763164800000.jpg';
    await renderWithProviders(<ProfileButton picture={{ kind: 'photo', uri }} />);
    expect(avatar().props.source).toEqual({ uri });
    const style = flat(avatar().props.style);
    expect(style.borderRadius).toBe(Number(style.width) / 2);
    expect(Number(style.width)).toBeLessThanOrEqual(layout.minTouch);
  });
});
