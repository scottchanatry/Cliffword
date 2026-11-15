import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import {
  colors,
  typography,
  type contentVariants,
  type interfaceVariants,
  type musicVariants,
  type TypographyVariant,
} from '../theme';

export type TextTone = 'ink' | 'muted' | 'mutedStrong' | 'accent' | 'onInk' | 'chip';

const toneColor: Record<TextTone, string> = {
  ink: colors.ink,
  muted: colors.muted,
  mutedStrong: colors.mutedStrong,
  accent: colors.accentText,
  onInk: colors.onInk,
  chip: colors.chipText,
};

export interface TextProps extends RNTextProps {
  /** A style from the type scale (src/theme/typography.ts). Default "body". */
  variant?: TypographyVariant;
  /** Text color. Default "ink". */
  tone?: TextTone;
}

/** Text in the app's type scale. Pass already-translated strings only. */
export function Text({ variant = 'body', tone = 'ink', style, ...rest }: TextProps) {
  return <RNText {...rest} style={[typography[variant], { color: toneColor[tone] }, style]} />;
}

type ContentVariant = (typeof contentVariants)[number];
type InterfaceVariant = (typeof interfaceVariants)[number];
type MusicVariant = (typeof musicVariants)[number];

/** Newsreader: story text, prompts, headlines. */
export function ContentText({
  variant = 'story',
  ...rest
}: Omit<TextProps, 'variant'> & { variant?: ContentVariant }) {
  return <Text variant={variant} {...rest} />;
}

/** Inter: labels, buttons, hints, captions. */
export function InterfaceText({
  variant = 'body',
  ...rest
}: Omit<TextProps, 'variant'> & { variant?: InterfaceVariant }) {
  return <Text variant={variant} {...rest} />;
}

/** Anton, uppercase: Music headings. Announced as a header. */
export function MusicHeading({
  variant = 'musicTitle',
  ...rest
}: Omit<TextProps, 'variant'> & { variant?: MusicVariant }) {
  return <Text accessibilityRole="header" variant={variant} {...rest} />;
}
