import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { slangNotes } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type Translator } from '../../i18n';
import type { LyricViewModel } from '../../session/contract';
import { useServices } from '../../services/ServicesProvider';
import { spacing } from '../../theme';
import { Text } from '../../ui';
import { VoiceDock } from '../story/VoiceDock';
import { EchoTiles } from './EchoTiles';
import { rawLineWords } from './lyricWords';
import { SongHeader } from './SongHeader';
import type { LyricKindProps } from './viewTypes';

/** "Rayo K. · playing in Apple Music": what the player is doing, never "playing" while it is stopped. */
export function echoSubtitle(t: Translator['t'], artist: string, playback: LyricViewModel['playback']): string {
  const who = artist.trim();
  if (!playback.available) return who;
  if (!who) return playback.playing ? t('music.player.playing') : t('music.player.stopped');
  return playback.playing ? t('music.echo.playing', { artist: who }) : t('music.echo.stopped', { artist: who });
}

/**
 * Sing the line back (B4): the track has stopped; the singer's row of tiles, the learner's row
 * after they sang ("6 of 7 landed", hollow tiles for missed words, tap one to hear it slowly),
 * "Hold anywhere and sing it again" and Más despacio / Otra vez / Siguiente.
 */
export function EchoView({ screen, vm, actions, toggleListen, openTyping }: LyricKindProps<'echo'>) {
  const { t, plural } = useI18n();
  const { packs } = useServices();
  const [held, setHeld] = useState<number | null>(null);
  const words = rawLineWords(packs.lang, screen.line, { regions: vm.regions, showExplicit: vm.showExplicit });
  const notes = slangNotes(screen.line, packs.lang, packs.pair, { regions: vm.regions ?? [], showExplicit: vm.showExplicit !== false });
  const missed = screen.tiles?.filter((tile) => tile.status === 'missed').length ?? 0;
  const sang = screen.tiles !== null;
  return (
    <>
      <SongHeader meta={screen.meta} subtitle={echoSubtitle(t, screen.meta.artist, vm.playback)} size="small" busy={vm.busy} />
      <Text variant="eyebrow" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="echo-eyebrow">
        {vm.playback.available && !vm.playback.playing ? t('music.trackStopped') : t('music.singBack')}
      </Text>
      <EchoTiles
        words={words}
        tiles={screen.tiles}
        singerLabel={screen.meta.artist.trim() || t('music.echo.singer')}
        held={held}
        onHold={setHeld}
        onHearMissed={actions.hearWord ? (i) => actions.hearWord?.(i) : undefined}
        notes={notes}
      />
      {sang && screen.ui ? (
        <View style={styles.result}>
          <Text variant="headline" accessibilityRole="header" style={styles.landed} maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="echo-landed" accessibilityLiveRegion="polite">
            {t(screen.ui.key, screen.ui.params)}
          </Text>
          {missed > 0 && actions.hearWord ? (
            <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="echo-tap-hollow">
              {plural('music.echo.tapHollow', missed)}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.spacer} />
      <VoiceDock
        title={sang ? t('hold.singAgain') : t('hold.singLine')}
        subtitle={vm.playback.available ? t('hold.musicWaits') : t('music.echo.ownPace')}
        listen={vm.listen}
        onToggle={toggleListen}
        commands={['slower', 'again', 'next']}
        onCommand={(c) => actions.command(c)}
        onType={openTyping}
        height={150}
        ringsWidth={96}
      />
    </>
  );
}

const styles = StyleSheet.create({
  result: { gap: spacing.xs },
  landed: { fontSize: 25, lineHeight: 30 },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
