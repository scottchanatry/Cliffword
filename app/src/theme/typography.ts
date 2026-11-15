/**
 * Type scale from the design previews. Sizes and line heights are in dp; line heights are
 * absolute because React Native has no unitless line-height.
 *
 * Three groups, one font each:
 * - content (Newsreader): story text, prompts, headlines, numbers;
 * - interface (Inter): labels, buttons, hints, captions;
 * - music (Anton, uppercase): Music headings and lyric lines.
 */
import type { TextStyle } from 'react-native';
import { fontFamilies } from './fonts';
import { eyebrowTracking } from './tokens';

type Variant = Pick<
  TextStyle,
  'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'textTransform'
>;

const content = {
  /** "Cliffword" wordmark in the header. */
  brand: { fontFamily: fontFamilies.contentSemiBold, fontSize: 22, lineHeight: 28 },
  /** Story sentences. */
  story: { fontFamily: fontFamilies.content, fontSize: 24, lineHeight: 36 },
  /** A line someone says to the learner, or the learner's own reply. */
  prompt: { fontFamily: fontFamilies.content, fontSize: 23, lineHeight: 31 },
  /** Result headlines ("You landed where a Spanish speaker would."). */
  headline: { fontFamily: fontFamilies.contentSemiBold, fontSize: 27, lineHeight: 32 },
  /** Screen titles ("Tell the market scene again"), song titles. */
  title: { fontFamily: fontFamilies.contentSemiBold, fontSize: 25, lineHeight: 30 },
  /** Hold-area titles, stat values. */
  contentTitle: { fontFamily: fontFamilies.contentSemiBold, fontSize: 22, lineHeight: 28 },
  /** Timers. */
  display: { fontFamily: fontFamilies.contentSemiBold, fontSize: 52, lineHeight: 56 },
} satisfies Record<string, Variant>;

const ui = {
  /** Card titles ("Say what comes next"). */
  cardTitle: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 19, lineHeight: 24 },
  /** Body copy inside cards. */
  body: { fontFamily: fontFamilies.interface, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 15, lineHeight: 21 },
  /** List row titles. */
  rowTitle: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 16, lineHeight: 22 },
  /** Hints under tiles and charts. */
  hint: { fontFamily: fontFamilies.interface, fontSize: 14, lineHeight: 20 },
  /** Meta lines, legends, status. */
  caption: { fontFamily: fontFamilies.interface, fontSize: 13, lineHeight: 18 },
  /** Uppercase section labels ("OR JUST SAY"). */
  eyebrow: {
    fontFamily: fontFamilies.interfaceSemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: eyebrowTracking,
    textTransform: 'uppercase',
  },
  /** Native-language gloss under a spoken command. */
  gloss: { fontFamily: fontFamilies.interface, fontSize: 12, lineHeight: 16 },
  /** Primary button label. */
  buttonPrimary: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 17, lineHeight: 22 },
  /** Outline and ghost button labels. */
  button: { fontFamily: fontFamilies.interfaceMedium, fontSize: 15, lineHeight: 20 },
  /** Pill labels. */
  pill: { fontFamily: fontFamilies.interfaceMedium, fontSize: 14, lineHeight: 18 },
  pillStrong: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 14, lineHeight: 18 },
  /** Tab bar labels. */
  tab: { fontFamily: fontFamilies.interfaceMedium, fontSize: 12, lineHeight: 16 },
} satisfies Record<string, Variant>;

const music = {
  /** Song title on the lyric cliff. */
  musicDisplay: {
    fontFamily: fontFamilies.music,
    fontSize: 46,
    lineHeight: 50,
    textTransform: 'uppercase',
  },
  /** Screen heading ("Your music"). */
  musicTitle: {
    fontFamily: fontFamilies.music,
    fontSize: 38,
    lineHeight: 42,
    textTransform: 'uppercase',
  },
  /** Section heading ("Same idea, two ways to say it"). */
  musicHeading: {
    fontFamily: fontFamilies.music,
    fontSize: 34,
    lineHeight: 37,
    textTransform: 'uppercase',
  },
  /** The current lyric line. */
  musicLine: {
    fontFamily: fontFamilies.music,
    fontSize: 40,
    lineHeight: 46,
    textTransform: 'uppercase',
  },
  /** The line before it. */
  musicLinePrev: {
    fontFamily: fontFamilies.music,
    fontSize: 22,
    lineHeight: 26,
    textTransform: 'uppercase',
  },
  /** Big music action ("SING IT"). */
  musicButton: {
    fontFamily: fontFamilies.music,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: 0.78,
    textTransform: 'uppercase',
  },
} satisfies Record<string, Variant>;

export const typography = { ...content, ...ui, ...music };

export type TypographyVariant = keyof typeof typography;

export const contentVariants = Object.keys(content) as (keyof typeof content)[];
export const interfaceVariants = Object.keys(ui) as (keyof typeof ui)[];
export const musicVariants = Object.keys(music) as (keyof typeof music)[];
