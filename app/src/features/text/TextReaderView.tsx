import { Pressable, StyleSheet, View } from 'react-native';
import type { LyricLineView, SurpriseUnit } from '@cliffword/engine';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { HeatLegend } from '../../components/words/HeatSentence';
import { useI18n } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { colors, layout, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { LyricLine } from '../music/LyricLine';
import { lineViewWords, spokenLine } from '../music/lyricWords';
import { CannedNote } from '../music/ReadView';
import { RegisterToggle } from '../music/RegisterToggle';
import { SlangNoteList } from '../music/SlangNoteList';
import { SongHeader } from '../music/SongHeader';
import type { LyricKindProps } from '../music/viewTypes';
import { sentenceHeat } from './textHeat';

/**
 * A text the learner brought (an article, a transcript), read with surprise shading: each
 * word on the amber scale by how much a Spanish speaker would not expect it there (the
 * engine's surprise map; unshaded until the model has scored it). A sentence opens on tap;
 * "Start the cliffs" stops the text mid-sentence, as the story does.
 */
export function TextReaderView({ screen, vm, actions }: LyricKindProps<'read'>) {
  const { t } = useI18n();
  const units = vm.surprise ?? null;
  return (
    <>
      <SongHeader meta={screen.meta} eyebrow={t('text.reader.eyebrow')} subtitle={t('text.reader.count', { n: screen.meta.total })} busy={vm.busy} />
      {vm.modelMode === 'canned' ? <CannedNote /> : null}
      {units ? (
        <HeatLegend />
      ) : (
        <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="text-no-heat">
          {t('text.reader.noHeat')}
        </Text>
      )}
      {screen.lines.length === 0 ? (
        <EmptyText />
      ) : (
        <View style={styles.text} testID="text-sentences">
          {screen.lines.map((line) => (
            <TextSentence key={line.index} line={line} unit={units?.find((u) => u.index === line.index)} onOpen={actions.openLine} />
          ))}
        </View>
      )}
      <SlangNoteList notes={screen.notes} />
      {screen.notes.length > 0 ? <RegisterToggle register={vm.register} onChange={actions.setRegister} regions={vm.regions} /> : null}
    </>
  );
}

/** Pinned under the text: "Start the cliffs". */
export function TextReaderFooter({ actions }: Pick<LyricKindProps<'read'>, 'actions'>) {
  const { t } = useI18n();
  return (
    <View style={styles.footer} testID="text-footer">
      <Button label={t('text.reader.start')} icon={<MicGlyph />} onPress={actions.next} testID="text-start" />
    </View>
  );
}

/** One sentence: words shaded by heat (named for screen readers), tap to open it. */
function TextSentence({ line, unit, onOpen }: { line: LyricLineView; unit: SurpriseUnit | undefined; onOpen: (index: number) => void }) {
  const { t } = useI18n();
  const { packs } = useServices();
  const words = lineViewWords(packs.lang, line);
  const heat = sentenceHeat(unit, words);
  const hot = words.filter((w) => (heat.get(w.index) ?? 0) >= 2 && !w.masked).map((w) => w.text);
  const label = spokenLine(words, t('word.masked'));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hot.length > 0 ? t('text.reader.sentenceA11y', { sentence: label, words: hot.join(t('music.note.regionJoin')) }) : label}
      accessibilityHint={t('music.line.hint')}
      onPress={() => onOpen(line.index)}
      testID={`text-sentence-${line.index}`}
      style={({ pressed }) => [styles.sentence, pressed && styles.pressed]}
    >
      <LyricLine words={words} look="ink" heat={heat} testID={`text-${line.index}`} />
    </Pressable>
  );
}

/** Nothing to read yet. */
export function EmptyText() {
  const { t } = useI18n();
  return (
    <Card tone="soft">
      <Text variant="body" tone="mutedStrong">
        {t('text.reader.empty')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  text: { gap: spacing.xs },
  sentence: { minHeight: layout.minTouch, justifyContent: 'center', borderRadius: spacing.sm },
  pressed: { backgroundColor: colors.borderSoft },
  footer: { paddingTop: spacing.md },
});
