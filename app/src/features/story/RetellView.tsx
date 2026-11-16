import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { RETELL_LANES, type RetellRoundView } from '@cliffword/engine';
import { isListening } from '../../components/voice/useListenToggle';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { templateParts } from '../../components/words/TemplateText';
import { useI18n } from '../../i18n';
import { borders, colors, fontFamilies, radii, spacing } from '../../theme';
import { Button, Text } from '../../ui';
import { clock, MetaRow, SpokenRight } from './StoryHeader';
import type { KindViewProps } from './types';

/** A word tile in a lane is never thinner than this. */
const MIN_TILE_PCT = 0.6;

/** The lane length of each round: done rounds from their results, the current from the screen, later ones from RETELL_LANES. */
export function laneLengths(screen: { round: number; rounds: number; laneMs: number; results: readonly RetellRoundView[] }): number[] {
  return Array.from({ length: screen.rounds }, (_, i) => screen.results[i]?.laneMs ?? (i === screen.round ? screen.laneMs : RETELL_LANES[i] ?? screen.laneMs));
}

/**
 * Time left in the lane while a round is being spoken: counts down from the lane length from
 * when it mounts running (it is keyed by the listening state, so it restarts with each
 * round), and shows the whole lane otherwise.
 */
function Countdown({ laneMs, running }: { laneMs: number; running: boolean }) {
  const { t } = useI18n();
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);
  const remaining = running ? Math.max(0, laneMs - (now - start)) : laneMs;
  return (
    <View style={styles.countdown} accessible accessibilityLabel={t('retell.leftA11y', { time: clock(t, remaining) })} testID="retell-countdown">
      <Text variant="display" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {clock(t, remaining)}
      </Text>
      <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('retell.leftInLane')}
      </Text>
    </View>
  );
}

/**
 * Timed retell (B3): three rounds of 60, 45 and 30 seconds. Each lane is as wide as its
 * round is long; a finished round shows its words as tiles and its pauses as holes. The
 * stats compare the first round with the latest (words a minute, pauses).
 */
export function RetellView({ screen, vm, actions, toggleListen }: KindViewProps<'retell'>) {
  const { t, plural } = useI18n();
  const lanes = laneLengths(screen);
  const longest = Math.max(...lanes, 1);
  const on = isListening(vm.listen);
  const latest = screen.results[screen.results.length - 1];
  const header = screen.done
    ? t('retell.doneHeader')
    : t('retell.header', { round: screen.round + 1, rounds: screen.rounds });
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={header} busy={vm.busy} right={<SpokenRight ms={vm.spokenTodayMs} />} />
      <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="retell-title">
        {screen.done ? t('retell.doneTitle') : t('retell.prompt')}
      </Text>
      {/* The scene as a reminder before the first round only: the rounds are told from memory (B3). */}
      {screen.scene && !screen.done && screen.round === 0 && screen.results.length === 0 && !on ? (
        <Text variant="hint" tone="muted" numberOfLines={3} maxFontSizeMultiplier={CONTENT_MAX_SCALE} style={styles.scene} testID="retell-scene">
          {screen.scene}
        </Text>
      ) : null}
      {!screen.done ? <Countdown key={`${screen.round}-${on}`} laneMs={screen.laneMs} running={on} /> : null}
      <View style={styles.lanes}>
        {lanes.map((laneMs, i) => (
          <Lane
            key={i}
            index={i}
            laneMs={laneMs}
            widthPct={(laneMs / longest) * 100}
            result={screen.results[i]}
            now={!screen.done && i === screen.round}
            live={on && i === screen.round}
          />
        ))}
      </View>
      <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('retell.lanesHint')}
      </Text>
      {latest ? (
        <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="retell-covered">
          {t('retell.covered', { n: latest.covered, m: latest.total })}
        </Text>
      ) : null}
      {screen.progress ? (
        <View style={styles.stats} testID="retell-stats">
          <Stat
            from={screen.progress.rounds > 1 ? screen.progress.wordsPerMinute.from : null}
            to={screen.progress.wordsPerMinute.to}
            label={t('retell.wordsPerMinute')}
            testID="retell-wpm"
          />
          <Stat
            from={screen.progress.rounds > 1 ? screen.progress.pauses.from : null}
            to={screen.progress.pauses.to}
            label={plural('retell.pausesLabel', screen.progress.pauses.to)}
            testID="retell-pauses"
          />
        </View>
      ) : null}
      <View style={styles.spacer} />
      {screen.done ? (
        <Button label={t('retell.nextChapter')} onPress={actions.next} testID="retell-next" />
      ) : (
        <View style={styles.control}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={on ? t('retell.finishRound') : t('retell.startRound')}
            onPress={on ? actions.holdEnd : toggleListen}
            testID={on ? 'retell-finish' : 'retell-start'}
            style={({ pressed }) => [styles.round, on ? styles.roundLive : styles.roundIdle, pressed && styles.pressed]}
          >
            {on ? <View style={styles.stop} /> : <MicGlyph />}
          </Pressable>
          <Text variant="body" tone="muted" style={styles.controlText} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="retell-say-listo">
            {on
              ? templateParts(t('retell.keepTalking'), { command: <Text key="cmd" variant="bodyStrong">{t('command.done.say')}</Text> })
              : t('retell.holdToStart')}
          </Text>
        </View>
      )}
    </>
  );
}

interface LaneProps {
  index: number;
  laneMs: number;
  widthPct: number;
  result?: RetellRoundView;
  /** The round being spoken now. */
  now: boolean;
  /** Listening in this round. */
  live: boolean;
}

/** One round: label, then a lane as wide as the round is long, with word tiles and pause holes. */
function Lane({ index, laneMs, widthPct, result, now, live }: LaneProps) {
  const { t, plural } = useI18n();
  const seconds = Math.round(laneMs / 1000);
  const label = now ? t('retell.roundNow', { round: index + 1, seconds }) : t('retell.roundLabel', { round: index + 1, seconds });
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / laneMs) * 100)).toFixed(2)}%` as const;
  return (
    <View style={styles.laneBox} testID={`retell-lane-${index}`}>
      <View style={styles.laneLabels}>
        <Text variant="caption" tone={now ? 'accent' : 'muted'} style={now && styles.bold} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {label}
        </Text>
        {result ? (
          <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {plural('retell.pauses', result.pauses.length)}
          </Text>
        ) : null}
      </View>
      <View
        testID={`retell-lane-${index}-track`}
        style={[styles.lane, { width: `${widthPct.toFixed(2)}%` }, result ? styles.laneDone : now ? styles.laneNow : styles.laneLater, live && styles.laneLive]}
      >
        {result?.tiles.map((tile, i) => (
          <View
            key={`w${i}`}
            testID={`retell-lane-${index}-word`}
            style={[styles.word, { left: pct(tile.startMs), width: `${Math.max(MIN_TILE_PCT, ((tile.endMs - tile.startMs) / laneMs) * 100).toFixed(2)}%` }]}
          />
        ))}
        {result?.pauses.map((p, i) => (
          <View key={`p${i}`} testID={`retell-lane-${index}-pause`} style={[styles.pause, { left: pct(p.startMs), width: pct(p.endMs - p.startMs) }]} />
        ))}
      </View>
    </View>
  );
}

/** "71 → 84" over "words a minute" (the first round against the latest; one value after the first round). */
function Stat({ from, to, label, testID }: { from: number | null; to: number; label: string; testID: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.stat} testID={testID}>
      <Text variant="contentTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {from === null
          ? String(to)
          : templateParts(t('retell.change'), { from: String(from), to: <Text key="to" variant="contentTitle" tone="accent">{String(to)}</Text> })}
      </Text>
      <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { fontFamily: fontFamilies.content },
  countdown: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm + 2 },
  lanes: { gap: spacing.md },
  laneBox: { gap: spacing.xs + 2 },
  laneLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  bold: { fontFamily: fontFamilies.interfaceSemiBold },
  lane: { height: 36, borderRadius: radii.chip, position: 'relative', overflow: 'hidden' },
  laneDone: { borderWidth: borders.hairline, borderColor: colors.border, backgroundColor: colors.card },
  laneNow: { borderWidth: borders.hairline, borderColor: colors.live, backgroundColor: colors.card },
  laneLive: { borderWidth: borders.strong },
  laneLater: { borderWidth: borders.hairline, borderStyle: 'dashed', borderColor: colors.borderDashed },
  word: { position: 'absolute', top: 7, height: 20, borderRadius: 3, backgroundColor: colors.dot },
  pause: { position: 'absolute', top: 7, height: 20 },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, gap: spacing.xxs, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2, borderRadius: radii.panel, backgroundColor: colors.card },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  control: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  controlText: { flex: 1 },
  round: { width: 72, height: 72, minHeight: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  roundLive: { backgroundColor: colors.live },
  roundIdle: { backgroundColor: colors.ink },
  pressed: { opacity: 0.85 },
  stop: { width: 22, height: 22, borderRadius: 5, backgroundColor: colors.ink },
});
