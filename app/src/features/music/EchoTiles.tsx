import { Text as Span, StyleSheet, View } from 'react-native';
import { GestureDetector, useLongPressGesture, useTapGesture } from 'react-native-gesture-handler';
import type { EchoTile, SlangNote } from '@cliffword/engine';
import { useRootHold } from '../../components/voice/HoldAnywhere';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { templateParts } from '../../components/words/TemplateText';
import { tileWidth } from '../../components/words/tileWidth';
import { TILE_HOLD_MS, TILE_TAP_MAX_MS } from '../../components/words/WordTile';
import { useI18n } from '../../i18n';
import { borders, colors, fontFamilies, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import type { LineWord } from './lyricWords';
import { regionLabel } from './regionNames';
import { noteMeaning } from './SlangNoteList';

/** Every tile has the same height: the singer's pitch cannot be read from the track (BRIEF), and the learner's is not measured yet. */
export const ECHO_TILE_HEIGHT = 36;
/** The design's 6 dp between tiles. */
const TILE_GAP = 6;
/** A tile is never narrower than this, so a short word stays a target to see. */
const MIN_ECHO_WIDTH = 22;

export function echoTileWidth(word: LineWord | undefined): number {
  return Math.max(MIN_ECHO_WIDTH, tileWidth(word?.durationMs ?? 0));
}

export interface EchoTilesProps {
  /** The line's words (lineWords on EchoScreen.line): widths, slang, masked. */
  words: readonly LineWord[];
  /** The engine's tiles after the learner sang (one per word, same order); null before. */
  tiles: readonly EchoTile[] | null;
  /** "Rayo K." above the singer's row. */
  singerLabel: string;
  /** The word the learner is holding (shown in its tile), or null. */
  held: number | null;
  onHold: (index: number) => void;
  /** Tap a hollow (missed) tile: hear the word slowly. Without it the learner row is drawn only. */
  onHearMissed?: (index: number) => void;
  /** Notes of the line's slang, to name a held slang word ("corillo · your crew · Puerto Rico"). */
  notes: readonly SlangNote[];
  testID?: string;
}

/**
 * Sing-back (B4): the singer's line as blank tiles, all the same height, slang underlined in
 * live orange; hold one to see the word. Under it, after the learner sang, the learner's row
 * in the same widths: landed tiles filled, a word sung differently lighter, a missed word
 * hollow (tap it to hear it slowly).
 */
export function EchoTiles({ words, tiles, singerLabel, held, onHold, onHearMissed, notes, testID = 'echo-tiles' }: EchoTilesProps) {
  const { t } = useI18n();
  const heldWord = held === null ? undefined : words[held];
  const heldNote = heldWord ? notes.find((n) => n.span.start < heldWord.end && heldWord.start < n.span.end) : undefined;
  return (
    <View style={styles.box} testID={testID}>
      <View style={styles.rowBox}>
        <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {singerLabel}
        </Text>
        <View style={styles.row} testID={`${testID}-singer`}>
          {words.map((w, i) => (
            <SingerTile key={w.index} word={w} slang={tiles?.[i]?.slang ?? w.slang} shown={held === i} onHold={onHold} />
          ))}
        </View>
      </View>
      <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-legend`}>
        {t('music.echo.legend')}
        {heldWord && !heldWord.masked ? (
          <Span>
            {t('music.note.sentenceGap')}
            {templateParts(t('music.echo.held'), {
              note: (
                <Span style={styles.inkText}>
                  {heldNote
                    ? t('music.echo.note', {
                        word: heldWord.text,
                        meaning: noteMeaning(heldNote),
                        region: heldNote.regions.map((r) => regionLabel(t, r)).join(t('music.note.regionJoin')),
                      })
                    : heldWord.text}
                </Span>
              ),
            })}
          </Span>
        ) : null}
      </Text>
      {tiles ? (
        <View style={styles.rowBox}>
          <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('music.echo.you')}
          </Text>
          <View style={styles.row} testID={`${testID}-learner`}>
            {tiles.map((tile, i) => (
              <LearnerTile key={`${i}-${tile.text}`} index={i} tile={tile} word={words[i]} onHear={onHearMissed} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SingerTile({ word, slang, shown, onHold }: { word: LineWord; slang: boolean; shown: boolean; onHold: (index: number) => void }) {
  const { t } = useI18n();
  const root = useRootHold();
  const hold = useLongPressGesture({
    minDuration: TILE_HOLD_MS,
    runOnJS: true,
    testID: `echo-tile-${word.index}-hold`,
    onActivate: () => onHold(word.index),
    block: root ?? undefined,
  });
  const visible = shown && !word.masked;
  return (
    <GestureDetector gesture={hold}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={visible ? word.text : t('tile.word', { n: word.index + 1 })}
        accessibilityHint={t('music.echo.tileHint')}
        accessibilityActions={[{ name: 'longpress', label: t('tile.action.see') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress' || event.nativeEvent.actionName === 'activate') onHold(word.index);
        }}
        testID={`echo-tile-${word.index}`}
        style={styles.cell}
      >
        <View
          testID={`echo-tile-${word.index}-face`}
          style={[
            styles.tile,
            { width: visible ? undefined : echoTileWidth(word), minWidth: echoTileWidth(word) },
            visible ? styles.shown : styles.singer,
            slang && styles.slang,
          ]}
        >
          {visible ? (
            <Text style={styles.shownText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {word.text}
            </Text>
          ) : null}
        </View>
      </View>
    </GestureDetector>
  );
}

function LearnerTile({ index, tile, word, onHear }: { index: number; tile: EchoTile; word: LineWord | undefined; onHear?: (index: number) => void }) {
  const { t } = useI18n();
  const width = echoTileWidth(word);
  const name = word?.masked ? t('word.masked') : tile.text;
  if (tile.status === 'missed') {
    return <MissedTile index={index} width={width} name={name} onHear={onHear} />;
  }
  return (
    <View
      style={[styles.cell, styles.staticCell]}
      accessible
      accessibilityLabel={tile.status === 'landed' ? t('music.echo.landedWord', { word: name }) : t('music.echo.otherWord', { word: name })}
      testID={`echo-you-${index}-${tile.status}`}
    >
      <View style={[styles.tile, { width }, tile.status === 'landed' ? styles.landed : styles.substituted]} />
    </View>
  );
}

function MissedTile({ index, width, name, onHear }: { index: number; width: number; name: string; onHear?: (index: number) => void }) {
  const { t } = useI18n();
  const root = useRootHold();
  const tap = useTapGesture({
    maxDuration: TILE_TAP_MAX_MS,
    runOnJS: true,
    enabled: onHear !== undefined,
    testID: `echo-you-${index}-tap`,
    onActivate: () => onHear?.(index),
    block: root ?? undefined,
  });
  const face = <View style={[styles.tile, styles.missed, { width }]} />;
  if (!onHear) {
    return (
      <View style={[styles.cell, styles.staticCell]} accessible accessibilityLabel={t('understood.missed', { word: name })} testID={`echo-you-${index}-missed`}>
        {face}
      </View>
    );
  }
  return (
    <GestureDetector gesture={tap}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('music.echo.hearMissed', { word: name })}
        accessibilityActions={[{ name: 'activate', label: t('tile.action.hear') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onHear(index);
        }}
        testID={`echo-you-${index}-missed`}
        style={styles.cell}
      >
        {face}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  rowBox: { gap: spacing.xxs },
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: TILE_GAP, alignItems: 'center' },
  cell: { minHeight: layout.minTouch, justifyContent: 'center' },
  staticCell: { minHeight: 0, height: layout.minTouch },
  tile: { height: ECHO_TILE_HEIGHT, borderRadius: radii.tile, overflow: 'hidden' },
  singer: { backgroundColor: colors.tileOld },
  slang: { borderBottomWidth: 3, borderBottomColor: colors.live },
  shown: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.ink },
  shownText: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 14, lineHeight: 18, color: colors.onInk },
  landed: { backgroundColor: colors.live },
  substituted: { backgroundColor: colors.heat2 },
  missed: { borderWidth: borders.strong, borderStyle: 'dashed', borderColor: colors.live },
  inkText: { color: colors.ink },
});
