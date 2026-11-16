import { StyleSheet, View } from 'react-native';
import type { LinePlay } from '@cliffword/engine';
import { CommandChips } from '../../components/voice/CommandChips';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type Translator } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { spacing } from '../../theme';
import { Button, Text } from '../../ui';
import { lineOf } from './LyricCliffView';
import { LyricLine } from './LyricLine';
import { lineViewWords } from './lyricWords';
import { ManualModeNote, NowPlayingBar, playClock } from './NowPlayingBar';
import { MusicTitle } from './SongHeader';
import type { LyricKindProps } from './viewTypes';

/** Where the line plays: "Starts at 0:42" (LRC), "You timed it at 0:42" (tapped), or read it yourself (manual). */
export function linePlayText(t: Translator['t'], play: LinePlay): string {
  if (play.mode === 'timed' && play.startMs !== null) return t('music.line.timed', { time: playClock(t, play.startMs) });
  if (play.mode === 'tapped' && play.startMs !== null) return t('music.line.tapped', { time: playClock(t, play.startMs) });
  return t('music.line.manual');
}

/**
 * A line without a cliff (too short, or every word is a name): the line itself with its slang,
 * where it plays, "Sing the line back" (the echo) and the commands; Siguiente moves on.
 */
export function LineView({ screen, vm, actions }: LyricKindProps<'line'>) {
  const { t } = useI18n();
  const { packs } = useServices();
  const words = lineViewWords(packs.lang, screen.line);
  return (
    <>
      <MusicTitle title={screen.meta.title || t('music.untitled')} subtitle={lineOf(t, screen.meta, screen.lineIndex)} busy={vm.busy} />
      <View style={styles.spacer} />
      <LyricLine words={words} look="music" testID="lyric-line-only" />
      <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="line-play">
        {linePlayText(t, screen.play)}
      </Text>
      <View style={styles.spacer} />
      <Button label={t('music.singBackLine')} icon={<MicGlyph />} onPress={actions.startEcho} testID="start-echo" />
      <Button variant="ghost" label={t('music.backToSong')} onPress={actions.showSong} testID="show-song" />
      {vm.playback.available ? <NowPlayingBar playback={vm.playback} onPlay={actions.play} onPause={actions.pause} look="card" /> : <ManualModeNote />}
      <CommandChips commands={['again', 'slower', 'next']} onCommand={(c) => actions.command(c)} />
    </>
  );
}

const styles = StyleSheet.create({
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
