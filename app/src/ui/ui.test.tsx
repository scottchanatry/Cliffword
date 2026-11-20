import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { colors, fontFamilies, layout } from '../theme';
import { Button, Card, ContentText, InterfaceText, MusicHeading, Pill, Screen } from './index';

const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe('Text variants', () => {
  it('use Newsreader for content, Inter for interface, Anton uppercase for music', async () => {
    await render(
      <>
        <ContentText>contenido</ContentText>
        <InterfaceText>label</InterfaceText>
        <MusicHeading>heading</MusicHeading>
      </>,
    );
    expect(flat(screen.getByText('contenido').props.style).fontFamily).toBe(fontFamilies.content);
    expect(flat(screen.getByText('label').props.style).fontFamily).toBe(fontFamilies.interface);
    const heading = flat(screen.getByRole('header').props.style);
    expect(heading.fontFamily).toBe(fontFamilies.music);
    expect(heading.textTransform).toBe('uppercase');
  });
});

describe('Button', () => {
  it('is an accessible button with a 44 dp target that fires onPress', async () => {
    const onPress = jest.fn();
    await render(<Button variant="ghost" label="go" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'go' });
    expect(flat(button.props.style).minHeight).toBeGreaterThanOrEqual(layout.minTouch);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws primary buttons in ink and blocks presses when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="primary" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'primary' });
    expect(flat(button.props.style).backgroundColor).toBe(colors.ink);
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Pill', () => {
  it('is a toggle with checked state when selected is given', async () => {
    const onPress = jest.fn();
    await render(<Pill label="PR" selected onPress={onPress} />);
    const pill = screen.getByRole('togglebutton', { name: 'PR' });
    expect(pill.props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(pill);
    expect(onPress).toHaveBeenCalled();
  });

  it('is a static chip without onPress', async () => {
    await render(<Pill label="chip" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('chip')).toBeOnTheScreen();
  });
});

describe('Card and Screen', () => {
  it('render children on white and ground', async () => {
    await render(
      <Screen testID="screen">
        <Card testID="card">
          <InterfaceText>inside</InterfaceText>
        </Card>
      </Screen>,
    );
    expect(flat(screen.getByTestId('card').props.style).backgroundColor).toBe(colors.card);
    expect(flat(screen.getByTestId('screen').props.style).backgroundColor).toBe(colors.ground);
    expect(screen.getByText('inside')).toBeOnTheScreen();
  });

  it('pins a footer under the scrolling content, outside the scroll', async () => {
    await render(
      <Screen scroll testID="screen" footer={<Button label="Continue" onPress={() => undefined} testID="go" />}>
        <InterfaceText>long content</InterfaceText>
      </Screen>,
    );
    type Node = { type: unknown; parent: Node | null };
    const inScroll = (node: Node | null): boolean => (node ? node.type === 'RCTScrollView' || inScroll(node.parent) : false);
    expect(inScroll(screen.getByText('long content') as unknown as Node)).toBe(true);
    expect(inScroll(screen.getByTestId('go') as unknown as Node)).toBe(false);
    expect(within(screen.getByTestId('screen-footer')).getByTestId('go')).toBeOnTheScreen();
  });
});
