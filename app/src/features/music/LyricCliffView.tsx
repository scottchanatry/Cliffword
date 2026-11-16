import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LyricMeta } from '@cliffword/engine';
import { CommandChips } from '../../components/voice/CommandChips';
import { CliffGap } from '../../components/words/CliffGap';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type Translator } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { borders, colors, radii, spacing } from '../../theme';
import { Button, Text } from '../../ui';
import { ExplicitPill } from './ExplicitPill';
import { LyricLine } from './LyricLine';
import { rawLineWords } from './lyricWords';
import { ManualModeNote, NowPlayingBar } from './NowPlayingBar';
import { OptionsSheet } from './OptionsSheet';
import { SingItButton } from './SingItButton';
import { CannedNote } from './ReadView';
import { MusicTitle } from './SongHeader';
import type { LyricKindProps } from './viewTypes';

/** "Rayo K. · line 2 of 24" (or "Line 2 of 24" without an artist). */
export function lineOf(t: Translator['t'], meta: LyricMeta, lineIndex: number): string {
  const n = lineIndex + 1;
  return meta.artist.trim() ? t('music.lineOf', { artist: meta.artist.trim(), n, m: meta.total }) : t('music.lineOnly', { n, m: meta.total });
}

/**
 * The lyric cliff (C1, the Tarima look): the song title in Anton, the line before, the line up
 * to the gap, "SING IT" (hold anywhere works the same), "Stuck? Show three options" on the
 * options rung, the rung's hint otherwise, the player bar that waits for the learner, and the
 * spoken commands.
 */
export function LyricCliffView({ screen, vm, actions, toggleListen, openTyping }: LyricKindProps<'cliff'>) {
  const { t } = useI18n();
  const { packs } = useServices();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const spanOpts = { regions: vm.regions, showExplicit: vm.showExplicit };
  const previous = screen.previous.trim() ? rawLineWords(packs.lang, screen.previous, spanOpts) : [];
  const before = rawLineWords(packs.lang, screen.before, spanOpts);
  const options = screen.rung === 'options' ? screen.options ?? [] : [];
  return (
    <>
      {vm.showExplicit !== undefined ? (
        <View style={styles.pillRow}>
          <ExplicitPill show={vm.showExplicit} onToggle={actions.setShowExplicit ? (show) => actions.setShowExplicit?.(show) : undefined} />
        </View>
      ) : null}
      <MusicTitle title={screen.meta.title || t('music.untitled')} subtitle={lineOf(t, screen.meta, screen.lineIndex)} busy={vm.busy} />
      {vm.modelMode === 'canned' ? <CannedNote /> : null}
      <View style={styles.spacer} />
      <View style={styles.lines} testID="lyric-cliff-lines">
        {previous.length > 0 ? <LyricLine words={previous} look="musicPrev" testID="lyric-previous" /> : null}
        <LyricLine words={before} look="music" after={<CliffGap variant="song" words={screen.gapLength} testID="lyric-gap" />} testID="lyric-current" />
      </View>
      {screen.rung !== 'options' || options.length === 0 ? (
        <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="lyric-rung">
          {t(screen.ui.key, screen.ui.params)}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      <SingItButton label={t('music.singIt')} listen={vm.listen} onToggle={toggleListen} />
      {options.length > 0 ? (
        <Button variant="outline" label={t('music.showOptions')} onPress={() => setOptionsOpen(true)} style={styles.stuck} testID="show-options" />
      ) : null}
      {vm.playback.available ? (
        <NowPlayingBar playback={vm.playback} onPlay={actions.play} onPause={actions.pause} waiting look="card" />
      ) : (
        <ManualModeNote />
      )}
      <View style={styles.dockLabel}>
        <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('commands.orJustSay')}
        </Text>
        <Button variant="ghost" muted label={t('action.typeInstead')} onPress={openTyping} testID="type-instead" style={styles.type} />
      </View>
      <CommandChips commands={['again', 'slower', 'dont_know']} onCommand={(c) => actions.command(c)} label={false} />
      <OptionsSheet
        visible={optionsOpen}
        options={options}
        title={t(screen.ui.key, screen.ui.params)}
        onPick={actions.pickOption}
        onClose={() => setOptionsOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: -spacing.sm },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  lines: { gap: spacing.md },
  stuck: { minHeight: 48, borderWidth: borders.strong, borderColor: colors.ink, borderRadius: radii.panel },
  dockLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  type: { marginRight: -spacing.sm },
});
