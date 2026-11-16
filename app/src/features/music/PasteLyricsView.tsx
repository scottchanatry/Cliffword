import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, fontFamilies, layout, radii, spacing } from '../../theme';
import { Button, Card, Screen, Text } from '../../ui';
import { FormField } from './FormField';
import { SlangNoteList } from './SlangNoteList';
import type { LyricsPreview, PasteLyricsProps } from './types';

/** The pasted text's lines (a line break is where the paste breaks lines), with their number in the text; blank lines left out. */
export function pastedLines(text: string): { at: number; text: string }[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line, at) => ({ at, text: line }))
    .filter((l) => l.text.trim().length > 0);
}

/** The text without its line `at` (other lines and their breaks kept as pasted). */
export function withoutLine(text: string, at: number): string {
  return text
    .split(/\r\n|\r|\n/)
    .filter((_, i) => i !== at)
    .join('\n');
}

/**
 * Paste lyrics: the song's title and artist (fixed for a shared or Apple Music song), the
 * lyrics field, and what Cliffword found in them before saving: lines, timed lines, lines left
 * out, slang notes and explicit words. Any pasted line can be deleted here (a credit, an ad).
 */
export function PasteLyricsView(props: PasteLyricsProps) {
  const { t } = useI18n();
  const lines = pastedLines(props.text);
  return (
    <Screen scroll testID="paste-screen" contentStyle={styles.content}>
      <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('paste.title')}
      </Text>
      {props.songFixed ? (
        <View style={styles.song} testID="paste-song">
          <Text variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {props.title}
          </Text>
          {props.artist ? (
            <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {props.artist}
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <FormField label={t('paste.songTitle')} value={props.title} onChangeText={props.onChangeTitle} autoCapitalize="words" testID="paste-title" />
          <FormField label={t('paste.artist')} value={props.artist} onChangeText={props.onChangeArtist} autoCapitalize="words" testID="paste-artist" />
        </>
      )}
      <FormField
        label={t('paste.lyrics')}
        placeholder={t('paste.placeholder')}
        value={props.text}
        onChangeText={props.onChangeText}
        multiline
        content
        autoCorrect={false}
        autoCapitalize="none"
        testID="paste-text"
      />
      {props.preview ? <PastePreview preview={props.preview} /> : (
        <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="paste-empty">
          {t('paste.empty')}
        </Text>
      )}
      {lines.length > 0 ? (
        <View style={styles.section} testID="paste-lines">
          <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('paste.yourLines')}
          </Text>
          <View style={styles.lines}>
            {lines.map((line, i) => (
              <View key={`${line.at}`} style={[styles.lineRow, i < lines.length - 1 && styles.divider]}>
                <Text variant="body" style={styles.lineText} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                  {line.text}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('paste.deleteLine', { n: i + 1, line: line.text.trim() })}
                  onPress={() => props.onChangeText(withoutLine(props.text, line.at))}
                  testID={`paste-delete-${i}`}
                  style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
                >
                  <View style={[styles.cross, styles.crossA]} />
                  <View style={[styles.cross, styles.crossB]} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {props.errorKey ? (
        <Text variant="body" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="paste-error" accessibilityLiveRegion="polite">
          {t(props.errorKey)}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      <Button label={props.saving ? t('paste.saving') : t('paste.save')} onPress={props.onSave} disabled={!props.canSave || props.saving} testID="paste-save" />
      <Button variant="ghost" muted label={t('common.cancel')} onPress={props.onCancel} testID="paste-cancel" />
    </Screen>
  );
}

/** What the parse found: counts, the slang notes and the first lines as Cliffword will show them. */
export function PastePreview({ preview }: { preview: LyricsPreview }) {
  const { t, plural } = useI18n();
  const counts = [
    plural('paste.lines', preview.lines),
    preview.timedLines > 0 ? plural('paste.timed', preview.timedLines) : null,
    preview.removed > 0 ? plural('paste.removed', preview.removed) : null,
    plural('paste.slang', preview.notes.length),
    preview.explicit > 0 ? plural('paste.explicit', preview.explicit) : null,
  ].filter((c): c is string => c !== null);
  return (
    <View style={styles.section} testID="paste-preview">
      <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('paste.found')}
      </Text>
      <Card style={styles.counts}>
        {counts.map((c, i) => (
          <Text key={`${i}-${c}`} variant={i === 0 ? 'bodyStrong' : 'body'} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`paste-count-${i}`}>
            {c}
          </Text>
        ))}
        {preview.firstLines.length > 0 ? (
          <View style={styles.first}>
            <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('paste.firstLines')}
            </Text>
            {preview.firstLines.map((line, i) => (
              <Text key={`${i}-${line}`} style={styles.firstLine} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>
      <SlangNoteList notes={preview.notes} testID="paste-notes" />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  song: { gap: spacing.xxs },
  section: { gap: spacing.sm },
  counts: { gap: spacing.xs },
  first: { gap: spacing.xxs, marginTop: spacing.sm },
  firstLine: { fontFamily: fontFamilies.content, fontSize: 18, lineHeight: 26, color: colors.ink },
  lines: { paddingHorizontal: spacing.lg, borderRadius: radii.list, backgroundColor: colors.card },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouch },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  lineText: { flex: 1, fontFamily: fontFamilies.content, fontSize: 17, lineHeight: 24 },
  delete: { width: layout.minTouch, height: layout.minTouch, minHeight: layout.minTouch, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.md, borderRadius: radii.pill },
  pressed: { backgroundColor: colors.borderSoft },
  cross: { position: 'absolute', width: 14, height: 2, borderRadius: 1, backgroundColor: colors.muted },
  crossA: { transform: [{ rotate: '45deg' }] },
  crossB: { transform: [{ rotate: '-45deg' }] },
  spacer: { flexGrow: 1, minHeight: spacing.sm },
});
