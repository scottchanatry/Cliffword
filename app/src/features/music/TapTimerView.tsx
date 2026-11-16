import { useEffect, useRef, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type Translator } from '../../i18n';
import { borders, colors, fontFamilies, layout, radii, spacing } from '../../theme';
import { Button, Screen, Text } from '../../ui';
import { NowPlayingBar } from './NowPlayingBar';
import type { TapTimerLine, TapTimerProps } from './types';

/** How far one nudge moves a tapped start. */
export const NUDGE_MS = 250;

/** "0:12.4": a tapped start to a tenth of a second, through the catalog's pattern. */
export function preciseClock(t: Translator['t'], ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const tenths = Math.floor(safe / 100);
  const total = Math.floor(tenths / 10);
  return t('time.precise', { m: Math.floor(total / 60), ss: String(total % 60).padStart(2, '0'), d: tenths % 10 });
}

/**
 * Time it while you listen: the song plays in Apple Music and the learner taps the big button
 * as each line starts. Every tapped line shows its time with Earlier and Later (a quarter
 * second each); Undo forgets the last tap. Once lines have times, the song pauses at them.
 */
export function TapTimerView(props: TapTimerProps) {
  const { t } = useI18n();
  const { current } = props;
  const all = current >= props.lines.length;
  const next = props.lines[current];
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const rows = useRef<Record<number, number>>({});
  // Keep the line the next tap marks in view.
  useEffect(() => {
    const y = rows.current[current];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  }, [current]);
  return (
    <Screen testID="time-screen" contentStyle={styles.content}>
      <View style={styles.head}>
        <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {t('time.title')}
        </Text>
        <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {props.artist ? t('time.song', { title: props.title, artist: props.artist }) : props.title}
        </Text>
        <Text variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {props.playback.available ? t('time.body') : t('time.noPlayer')}
        </Text>
      </View>
      <ScrollView ref={scroll} style={styles.list} contentContainerStyle={styles.listContent} testID="time-lines">
        {props.lines.map((line) => (
          <View key={line.index} onLayout={(e) => (rows.current[line.index] = e.nativeEvent.layout.y)}>
            <TimedLine line={line} current={line.index === props.current} onNudge={props.onNudge} />
          </View>
        ))}
      </ScrollView>
      {props.playback.available ? <NowPlayingBar playback={props.playback} onPlay={props.onPlay} onPause={props.onPause} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={all ? t('time.allDone') : t('time.tap', { n: props.current + 1 })}
        accessibilityHint={next ? next.text : undefined}
        accessibilityState={{ disabled: all || !props.playback.available }}
        disabled={all || !props.playback.available}
        onPress={props.onTap}
        testID="time-tap"
        style={({ pressed }) => [styles.tap, (all || !props.playback.available) && styles.tapOff, pressed && styles.pressed]}
      >
        <Text variant="musicButton" tone="onInk" numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {all ? t('time.allDone') : t('time.tap', { n: props.current + 1 })}
        </Text>
      </Pressable>
      <View style={styles.row}>
        <Button variant="ghost" muted label={t('time.undo')} onPress={props.onUndo} disabled={props.current === 0} testID="time-undo" />
        <Button variant="outline" label={t('common.done')} onPress={props.onDone} style={styles.done} testID="time-done" />
      </View>
    </Screen>
  );
}

function TimedLine({ line, current, onNudge }: { line: TapTimerLine; current: boolean; onNudge: (index: number, deltaMs: number) => void }) {
  const { t } = useI18n();
  const n = line.index + 1;
  return (
    <View style={[styles.line, current && styles.lineNow]} testID={`time-line-${line.index}`} accessibilityState={{ selected: current }}>
      <View style={styles.lineText}>
        <Text style={styles.lyric} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {line.text}
        </Text>
        <Text variant="caption" tone={line.startMs === null ? 'muted' : 'accent'} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`time-at-${line.index}`}>
          {line.startMs === null ? t('time.notYet') : preciseClock(t, line.startMs)}
        </Text>
      </View>
      {line.startMs !== null ? (
        <View style={styles.nudges}>
          <Button variant="outline" label={t('time.earlier')} accessibilityLabel={t('time.earlierA11y', { n })} onPress={() => onNudge(line.index, -NUDGE_MS)} testID={`time-earlier-${line.index}`} style={styles.nudge} />
          <Button variant="outline" label={t('time.later')} accessibilityLabel={t('time.laterA11y', { n })} onPress={() => onNudge(line.index, NUDGE_MS)} testID={`time-later-${line.index}`} style={styles.nudge} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  head: { gap: spacing.xs },
  list: { flex: 1, borderRadius: radii.list, backgroundColor: colors.card },
  listContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  lineNow: { borderLeftWidth: 3, borderLeftColor: colors.live, paddingLeft: spacing.sm, marginLeft: -spacing.sm - 3 },
  lineText: { flex: 1, gap: spacing.xxs },
  lyric: { fontFamily: fontFamilies.content, fontSize: 18, lineHeight: 25, color: colors.ink },
  nudges: { flexDirection: 'row', gap: spacing.xs },
  nudge: { paddingHorizontal: spacing.sm },
  tap: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radii.list,
    backgroundColor: colors.ink,
  },
  tapOff: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: { minWidth: 120, borderWidth: borders.strong, borderColor: colors.ink, minHeight: layout.minTouch },
});
