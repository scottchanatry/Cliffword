import { Pressable, StyleSheet, View } from 'react-native';
import type { LyricLineView } from '@cliffword/engine';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { colors, layout, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { LyricLine } from './LyricLine';
import { lineViewWords, spokenLine } from './lyricWords';
import { ManualModeNote, NowPlayingBar } from './NowPlayingBar';
import { mainRegion } from './regionNames';
import { RegisterToggle } from './RegisterToggle';
import { SlangNoteList } from './SlangNoteList';
import { SongHeader } from './SongHeader';
import type { LyricKindProps } from './viewTypes';

/**
 * The song page (A3): the title and where its slang is from, every line with its slang
 * underlined (a line opens on tap), the slang notes, "Teach me to speak" (neutral or street),
 * the player bar (or the manual-mode note) and "Sing the next word".
 */
export function ReadView({ screen, vm, actions, nav }: LyricKindProps<'read'>) {
  const { t } = useI18n();
  const region = mainRegion(screen.notes);
  return (
    <>
      <SongHeader meta={screen.meta} region={region} eyebrow={t('music.fromLibrary')} busy={vm.busy} />
      {vm.modelMode === 'canned' ? <CannedNote /> : null}
      {screen.lines.length === 0 ? (
        <EmptyLines />
      ) : (
        <View style={styles.lines} testID="song-lines">
          {screen.lines.map((line) => (
            <SongLine key={line.index} line={line} onOpen={actions.openLine} />
          ))}
        </View>
      )}
      <SlangNoteList notes={screen.notes} />
      <RegisterToggle register={vm.register} onChange={actions.setRegister} regions={vm.regions} />
      <SongLinks nav={nav} canTime={vm.playback.available && screen.playback !== 'timed'} />
    </>
  );
}

/**
 * The bottom of the song page, pinned under the lines (A3): the player bar (or the manual-mode
 * note) and "Sing the next word".
 */
export function ReadFooter({ vm, actions }: Pick<LyricKindProps<'read'>, 'vm' | 'actions'>) {
  const { t } = useI18n();
  return (
    <View style={styles.footer} testID="song-footer">
      {vm.playback.available ? <NowPlayingBar playback={vm.playback} onPlay={actions.play} onPause={actions.pause} /> : <ManualModeNote />}
      <Button label={t('music.singNextWord')} icon={<MicGlyph />} onPress={actions.next} testID="sing-next-word" />
    </View>
  );
}

/** One line of the song page: tap it to open it (play it, or show it in manual mode). */
export function SongLine({ line, onOpen }: { line: LyricLineView; onOpen: (index: number) => void }) {
  const { t } = useI18n();
  const { packs } = useServices();
  const words = lineViewWords(packs.lang, line);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenLine(words, t('word.masked'))}
      accessibilityHint={t('music.line.hint')}
      onPress={() => onOpen(line.index)}
      testID={`song-line-${line.index}`}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
    >
      <LyricLine words={words} look="ink" muted={line.repeat} testID={`lyric-${line.index}`} />
    </Pressable>
  );
}

/** Until the model is ready, cliffs come from the lines themselves. */
export function CannedNote() {
  const { t } = useI18n();
  return (
    <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="song-canned">
      {t('music.canned')}
    </Text>
  );
}

/** Ghost links to the song's other pages, when the route offers them. */
function SongLinks({ nav, canTime }: { nav: LyricKindProps<'read'>['nav']; canTime: boolean }) {
  const { t } = useI18n();
  const links = [
    nav?.onOpenRegisters ? { id: 'registers', label: t('music.openRegisters'), onPress: nav.onOpenRegisters } : null,
    canTime && nav?.onTimeIt ? { id: 'time', label: t('music.timeIt'), onPress: nav.onTimeIt } : null,
    nav?.onEditLyrics ? { id: 'edit', label: t('music.editLyrics'), onPress: nav.onEditLyrics } : null,
  ].filter((l): l is { id: string; label: string; onPress: () => void } => l !== null);
  if (links.length === 0) return null;
  return (
    <View style={styles.links}>
      {links.map((l) => (
        <Button key={l.id} variant="ghost" label={l.label} onPress={l.onPress} testID={`song-link-${l.id}`} />
      ))}
    </View>
  );
}

/** A quiet card for lines a song does not have yet. */
export function EmptyLines() {
  const { t } = useI18n();
  return (
    <Card tone="soft">
      <Text variant="body" tone="mutedStrong">
        {t('music.noLines')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 0 },
  line: { minHeight: layout.minTouch, justifyContent: 'center', borderRadius: spacing.sm },
  pressed: { backgroundColor: colors.borderSoft },
  links: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.sm },
  footer: { gap: spacing.md, paddingTop: spacing.md },
});
