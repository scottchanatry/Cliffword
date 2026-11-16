import { StyleSheet, View } from 'react-native';
import { GestureDetector, useExclusiveGestures, useLongPressGesture, useTapGesture } from 'react-native-gesture-handler';
import type { ViewWord } from '@cliffword/engine';
import { useI18n } from '../../i18n';
import { colors, fontFamilies, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { useRootHold } from '../voice/HoldAnywhere';
import { CHROME_MAX_SCALE } from './fontScale';
import { tileWidth } from './tileWidth';

/** Holding a tile this long shows the word (and never starts listening). */
export const TILE_HOLD_MS = 300;
/** A touch released within this time is a tap (hear the word). */
export const TILE_TAP_MAX_MS = 280;

/** Tile shade by sentence age: 0 is the current sentence (darkest), 2 the oldest shown (lightest). */
export type TileShade = 0 | 1 | 2;

const SHADES: Record<TileShade, string> = { 0: colors.tileOld, 1: colors.tileMid, 2: colors.tileNew };

export interface WordTileProps {
  word: ViewWord;
  shade?: TileShade;
  /** Being spoken by TTS right now. */
  speaking?: boolean;
  /** In the Ink look the tile sits inside a line of text (shorter, centred in the line). */
  inline?: boolean;
  onHear: (index: number) => void;
  onReveal: (index: number) => void;
}

/**
 * A word heard but not shown: a blank tile as wide as the word is long. Tap to hear it,
 * hold to see it; the hold wins over hold-anywhere. Its accessible name is "Word n", never
 * the hidden word.
 */
export function WordTile({ word, shade = 0, speaking = false, inline = false, onHear, onReveal }: WordTileProps) {
  const { t } = useI18n();
  const root = useRootHold();
  const hold = useLongPressGesture({
    minDuration: TILE_HOLD_MS,
    runOnJS: true,
    testID: `tile-${word.index}-hold`,
    onActivate: () => onReveal(word.index),
    block: root ?? undefined,
  });
  const tap = useTapGesture({
    maxDuration: TILE_TAP_MAX_MS,
    runOnJS: true,
    testID: `tile-${word.index}-tap`,
    onActivate: () => onHear(word.index),
    block: root ?? undefined,
  });
  const gesture = useExclusiveGestures(hold, tap);
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('tile.word', { n: word.index + 1 })}
        accessibilityHint={t('tile.a11y.hint')}
        accessibilityActions={[
          { name: 'activate', label: t('tile.action.hear') },
          { name: 'longpress', label: t('tile.action.see') },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onHear(word.index);
          if (event.nativeEvent.actionName === 'longpress') onReveal(word.index);
        }}
        testID={`tile-${word.index}`}
        style={[styles.cell, inline && styles.cellInline]}
      >
        <View
          testID={`tile-${word.index}-face`}
          style={[
            styles.tile,
            inline && styles.tileInline,
            { width: tileWidth(word.durationMs), backgroundColor: speaking ? colors.live : SHADES[shade] },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

/** A tile of an earlier sentence: drawn only (no gestures, hidden from screen readers). */
export function StaticTile({ word, shade, inline = false }: { word: ViewWord; shade: TileShade; inline?: boolean }) {
  return (
    <View style={[styles.cell, styles.staticCell, inline && styles.cellInline]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.tile, inline && styles.tileInline, { width: tileWidth(word.durationMs), backgroundColor: SHADES[shade] }]} />
    </View>
  );
}

export interface TextChipProps {
  word: ViewWord;
  speaking?: boolean;
  /** The answer just landed (live orange) on a landing. */
  answer?: boolean;
  onHear?: (index: number) => void;
}

/**
 * A word shown among tiles (Voice look): white on ink, like "puesto" in B1. Tap to hear it.
 * Words of earlier sentences are drawn only.
 */
export function TextChip({ onHear, ...rest }: TextChipProps) {
  return onHear ? <LiveTextChip {...rest} onHear={onHear} /> : <View style={[styles.cell, styles.staticCell]}><ChipFace {...rest} /></View>;
}

function ChipFace({ word, speaking = false, answer = false }: Omit<TextChipProps, 'onHear'>) {
  const live = speaking || answer;
  return (
    <View style={[styles.chip, live && styles.chipLive]}>
      <Text style={[styles.chipText, live && styles.chipTextLive]} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {word.text}
      </Text>
    </View>
  );
}

function LiveTextChip({ word, speaking, answer, onHear }: TextChipProps & { onHear: (index: number) => void }) {
  const { t } = useI18n();
  const root = useRootHold();
  const tap = useTapGesture({
    maxDuration: TILE_TAP_MAX_MS,
    runOnJS: true,
    testID: `word-${word.index}-tap`,
    onActivate: () => onHear(word.index),
    block: root ?? undefined,
  });
  const face = <ChipFace word={word} speaking={speaking} answer={answer} />;
  return (
    <GestureDetector gesture={tap}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={word.text}
        accessibilityHint={t('word.a11y.hint')}
        accessibilityActions={[{ name: 'activate', label: t('tile.action.hear') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onHear(word.index);
        }}
        testID={`word-${word.index}`}
        style={styles.cell}
      >
        {face}
      </View>
    </GestureDetector>
  );
}

/** A word not heard yet, after the cliff (Voice look): a dashed outline as wide as the word. */
export function FutureTile({ word }: { word: ViewWord }) {
  return (
    <View style={[styles.cell, styles.staticCell]} testID={`future-${word.index}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.tile, styles.future, { width: tileWidth(word.durationMs) }]} />
    </View>
  );
}

/** An explicit word hidden by the learner's setting: a muted tile with dots, never played. */
export function MaskedWord({ word, inline = false }: { word: ViewWord; inline?: boolean }) {
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityLabel={t('word.masked')}
      testID={`masked-${word.index}`}
      style={[styles.cell, styles.staticCell, inline && styles.cellInline]}
    >
      <View style={[styles.tile, inline && styles.tileInline, styles.masked, { width: tileWidth(word.durationMs) }]}>
        <View style={styles.maskDot} />
        <View style={styles.maskDot} />
        <View style={styles.maskDot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Every tile sits in a 44 dp tall cell: the touch target (and the design's 32 + 12 row pitch). */
  cell: { minHeight: layout.minTouch, justifyContent: 'center' },
  /** Drawn-only cells keep the row pitch without being a target. */
  staticCell: { minHeight: 0, height: layout.minTouch },
  /** Inside a 36 dp line of text: a 44 dp target that overlaps the lines above and below. */
  cellInline: { marginVertical: -4, marginHorizontal: spacing.xxs },
  tile: { height: 32, borderRadius: radii.tile },
  tileInline: { height: 26 },
  chip: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.tile,
    backgroundColor: colors.ink,
  },
  chipLive: { backgroundColor: colors.live },
  chipText: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 14, lineHeight: 18, color: colors.onInk },
  chipTextLive: { color: colors.ink },
  future: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderDashed },
  masked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: colors.borderSoft,
    minWidth: 30,
  },
  maskDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.muted },
});
