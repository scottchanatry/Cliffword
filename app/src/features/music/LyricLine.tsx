import type { ReactNode } from 'react';
import { Text as Span, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { tileWidth } from '../../components/words/tileWidth';
import { useI18n } from '../../i18n';
import { colors, heatColors, radii, spacing, typography } from '../../theme';
import type { LineWord } from './lyricWords';

/**
 * ink: Newsreader at story size (A3, a brought text). music: the current line in Anton (C1).
 * musicPrev: the line before it, smaller and muted (C1). card: Inter on a register card (C2).
 */
export type LyricLineLook = 'ink' | 'music' | 'musicPrev' | 'card';

export interface LyricLineProps {
  /** The line's words (lineWords / lineViewWords), as the pack's segmenter gives them. */
  words: readonly LineWord[];
  look?: LyricLineLook;
  /** Muted ink (the earlier line on the song page). */
  muted?: boolean;
  /** On ink (the street card). */
  onInk?: boolean;
  /** Underline slang (the song page). Default: on for the ink look. */
  underlineSlang?: boolean;
  /** Drawn after the last word, on the same line when it fits (the cliff gap). */
  after?: ReactNode;
  /** Words lit in live orange (the answer on a result). */
  highlight?: (index: number) => boolean;
  /** Surprise shading per word index (0 expected .. 3 most surprising), as the reader of a brought text draws it. */
  heat?: ReadonlyMap<number, 0 | 1 | 2 | 3>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const LOOK = {
  ink: { ...typography.story },
  music: { ...typography.musicLine },
  musicPrev: { ...typography.musicLinePrev },
  card: { ...typography.cardTitle, lineHeight: 26 },
} as const;

/**
 * A lyric line drawn word by word: each word with its own punctuation and its own space as
 * written (no space is ever added, so a script without spaces stays as written). Slang is
 * underlined with the dotted accent line at the engine's character spans; a masked word
 * (explicit lyrics off) is a blank chip named "Hidden word". Words wrap as a paragraph.
 */
export function LyricLine({
  words,
  look = 'ink',
  muted = false,
  onInk = false,
  underlineSlang = look === 'ink',
  after,
  highlight,
  heat,
  style,
  testID = 'lyric-line',
}: LyricLineProps) {
  const color = onInk ? colors.onInk : muted || look === 'musicPrev' ? colors.muted : colors.ink;
  const text = [LOOK[look], { color }];
  const scale = look === 'card' ? CHROME_MAX_SCALE : CONTENT_MAX_SCALE;
  return (
    <View style={[styles.row, style]} testID={testID}>
      {words.map((w) =>
        w.masked ? (
          <MaskedChip key={w.index} word={w} look={look} onInk={onInk} />
        ) : (
          <Span key={w.index} style={text} maxFontSizeMultiplier={scale} testID={`${testID}-word-${w.index}`}>
            {w.lead}
            <Span
              style={[
                underlineSlang && w.slang ? styles.slang : null,
                heatColors[heat?.get(w.index) ?? 0] ? { backgroundColor: heatColors[heat?.get(w.index) ?? 0] ?? undefined } : null,
                highlight?.(w.index) ? styles.lit : null,
              ]}
              testID={underlineSlang && w.slang ? `${testID}-slang-${w.index}` : highlight?.(w.index) ? `${testID}-lit-${w.index}` : undefined}
            >
              {w.text}
            </Span>
            {w.trail}
            {w.spaceAfter ? ' ' : ''}
          </Span>
        ),
      )}
      {after}
    </View>
  );
}

/** A hidden explicit word: a blank chip as wide as the word sounds, three dots inside. */
function MaskedChip({ word, look, onInk }: { word: LineWord; look: LyricLineLook; onInk: boolean }) {
  const { t } = useI18n();
  const height = Math.round(LOOK[look].fontSize * (look === 'card' ? 1.1 : 0.85));
  return (
    <View style={styles.maskedCell}>
      {word.lead ? <Span style={[LOOK[look], { color: onInk ? colors.onInk : colors.ink }]}>{word.lead}</Span> : null}
      <View
        accessible
        accessibilityLabel={t('word.masked')}
        testID={`masked-${word.index}`}
        style={[styles.masked, onInk && styles.maskedOnInk, { height, width: Math.max(tileWidth(word.durationMs), height * 1.6) }]}
      >
        <View style={[styles.dot, onInk && styles.dotOnInk]} />
        <View style={[styles.dot, onInk && styles.dotOnInk]} />
        <View style={[styles.dot, onInk && styles.dotOnInk]} />
      </View>
      <Span style={[LOOK[look], { color: onInk ? colors.onInk : colors.ink }]}>
        {word.trail}
        {word.spaceAfter ? ' ' : ''}
      </Span>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  slang: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: colors.accentText,
  },
  lit: { backgroundColor: colors.live, color: colors.ink },
  maskedCell: { flexDirection: 'row', alignItems: 'center' },
  masked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.xxs,
    borderRadius: radii.tile,
    backgroundColor: colors.tileMid,
  },
  maskedOnInk: { backgroundColor: colors.mutedStrong },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.card },
  dotOnInk: { backgroundColor: colors.ink },
});
