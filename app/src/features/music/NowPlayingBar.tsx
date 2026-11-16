import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { clockParts, useI18n, type Translator } from '../../i18n';
import type { PlaybackState } from '../../session/contract';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { Card, Text } from '../../ui';

/** "0:42": a playback position through the catalog's clock pattern. */
export function playClock(t: Translator['t'], ms: number): string {
  return t('time.clock', clockParts(ms));
}

/**
 * What the bar says: playing ("0:42 · playing in Apple Music"); stopped on a cliff or an echo
 * ("0:19 · the music waits for you"); paused elsewhere ("0:42 · paused in Apple Music").
 * Never "playing" while the track is stopped.
 */
export function playbackLine(t: Translator['t'], playback: PlaybackState, waiting: boolean): string {
  const time = playClock(t, playback.positionMs);
  if (playback.playing) return t('music.playingIn', { time });
  return waiting ? t('music.waits', { time }) : t('music.pausedIn', { time });
}

export interface NowPlayingBarProps {
  playback: PlaybackState;
  onPlay: () => void;
  onPause: () => void;
  /** The song stopped for the learner (cliff, echo): "the music waits for you". */
  waiting?: boolean;
  /** card: inside a white card with an ink button (C1). plain: on the ground with a white button (A3). */
  look?: 'card' | 'plain';
  testID?: string;
}

/** The Apple Music player bar: play or pause, the position on a thin track, and what the track is doing. */
export function NowPlayingBar({ playback, onPlay, onPause, waiting = false, look = 'plain', testID = 'now-playing' }: NowPlayingBarProps) {
  const { t } = useI18n();
  const share = playback.durationMs && playback.durationMs > 0 ? Math.min(1, Math.max(0, playback.positionMs / playback.durationMs)) : 0;
  const card = look === 'card';
  const label = playback.playing ? t('action.pause') : t('action.play');
  const iconColor = card ? colors.onInk : colors.ink;
  const body = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={playback.playing ? onPause : onPlay}
        testID={`${testID}-toggle`}
        style={({ pressed }) => [styles.button, card ? styles.buttonInk : styles.buttonPlain, pressed && styles.pressed]}
      >
        {playback.playing ? (
          <View style={styles.pause}>
            <View style={[styles.bar, { backgroundColor: iconColor }]} />
            <View style={[styles.bar, { backgroundColor: iconColor }]} />
          </View>
        ) : (
          <View style={[styles.triangle, { borderLeftColor: iconColor }]} />
        )}
      </Pressable>
      <View style={styles.right}>
        <View
          style={[styles.track, card ? styles.trackCard : styles.trackPlain]}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('music.position')}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
        >
          <View style={[styles.fill, { width: `${(share * 100).toFixed(1)}%` as const }]} />
        </View>
        <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-line`} accessibilityLiveRegion="polite">
          {playbackLine(t, playback, waiting)}
        </Text>
      </View>
    </>
  );
  return card ? (
    <Card style={styles.cardBox} testID={testID}>
      {body}
    </Card>
  ) : (
    <View style={styles.plainBox} testID={testID}>
      {body}
    </View>
  );
}

/** No player for this song (no Apple Music here, or the song is not linked): the learner reads and sings line by line. */
export function ManualModeNote({ testID = 'manual-mode' }: { testID?: string }) {
  const { t } = useI18n();
  return (
    <Card tone="soft" testID={testID}>
      <Text variant="body" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('music.manualMode')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  plainBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2, borderRadius: radii.list },
  button: { alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  buttonPlain: {
    width: 48,
    height: 48,
    minHeight: 48,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  buttonInk: { width: layout.minTouch, height: layout.minTouch, minHeight: layout.minTouch, backgroundColor: colors.ink },
  pressed: { opacity: 0.8 },
  triangle: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  pause: { flexDirection: 'row', gap: 4 },
  bar: { width: 4, height: 14, borderRadius: 1 },
  right: { flex: 1, gap: spacing.xs + 2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  trackPlain: { backgroundColor: colors.track },
  trackCard: { backgroundColor: colors.borderSoft },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.ink },
});
