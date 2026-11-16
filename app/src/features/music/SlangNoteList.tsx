import { Text as Span, StyleSheet, View } from 'react-native';
import type { SlangNote } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { templateParts } from '../../components/words/TemplateText';
import { useI18n, type Translator } from '../../i18n';
import { colors, fontFamilies, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { regionLabel } from './regionNames';

/** What a note says the word means: the neutral form for clipped forms ("está"), else the gloss, else the neutral word. */
export function noteMeaning(note: SlangNote): string {
  if (note.kind === 'clipped') return note.neutral;
  return note.gloss?.trim() || note.neutral;
}

/** "Puerto Rico · Casual · Explicit": regions, formality and the explicit label, through the pair's keys. */
export function noteLabels(t: Translator['t'], note: SlangNote): string {
  const parts = [note.regions.map((r) => regionLabel(t, r)).join(t('music.note.regionJoin')), t(note.labels.formality)];
  if (note.labels.explicit) parts.push(t(note.labels.explicit));
  return parts.filter((p) => p.trim().length > 0).join(t('music.note.separator'));
}

export interface SlangNoteListProps {
  /** The engine's notes (the read screen's, which already leave out explicit ones when explicit lyrics are off). */
  notes: readonly SlangNote[];
  /**
   * Leave explicit notes out. The read screen's notes already follow the setting; this is for
   * notes looked up by the view.
   */
  hideExplicit?: boolean;
  testID?: string;
}

/**
 * The song's slang (A3): "janguear · to hang out" with "Puerto Rico · Casual" under it, one
 * row per slang lexeme, in a white card. Nothing when there is no slang.
 */
export function SlangNoteList({ notes, hideExplicit = false, testID = 'slang-notes' }: SlangNoteListProps) {
  const { t } = useI18n();
  const shown = hideExplicit ? notes.filter((n) => !n.explicit) : notes;
  if (shown.length === 0) return null;
  return (
    <View style={styles.card} testID={testID} accessibilityRole="list">
      {shown.map((note, i) => (
        <View key={`${note.key}-${i}`} style={[styles.row, i < shown.length - 1 && styles.divider]} testID={`slang-note-${note.lemma}`}>
          <Text variant="body" style={styles.lineText} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {templateParts(t('music.note.line'), {
              word: (
                <Span style={styles.word} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                  {note.text}
                </Span>
              ),
              meaning: noteMeaning(note),
            })}
          </Text>
          <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {noteLabels(t, note)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.lg + 2, borderRadius: radii.card, backgroundColor: colors.card },
  row: { gap: spacing.xxs, paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  lineText: { fontSize: 16, lineHeight: 22 },
  word: { fontFamily: fontFamilies.interfaceSemiBold },
});
