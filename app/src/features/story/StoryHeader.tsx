import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { StoryMeta, TextMode } from '@cliffword/engine';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { clockParts, useI18n, type Translator } from '../../i18n';
import { colors, spacing } from '../../theme';
import { Pill, Text } from '../../ui';

/** "4:12": a duration through the catalog's clock pattern. */
export function clock(t: Translator['t'], ms: number): string {
  return t('time.clock', clockParts(ms));
}

/** "Chapter 3 · El mercado" (generated scenes have no title: "Chapter 3"). */
export function chapterLine(t: Translator['t'], meta: StoryMeta): string {
  return meta.title ? t('story.chapter', { n: meta.chapter, title: meta.title }) : t('story.chapterOnly', { n: meta.chapter });
}

/** "Chapter 3 · El mercado · spoken 4:12", with today's speaking time. */
export function metaLine(t: Translator['t'], meta: StoryMeta, spokenTodayMs: number): string {
  const time = clock(t, spokenTodayMs);
  return meta.title ? t('story.meta', { n: meta.chapter, title: meta.title, time }) : t('story.metaNoTitle', { n: meta.chapter, time });
}

export interface MetaRowProps {
  /** The left text (already translated). */
  text: string;
  /** Ink look: 12 dp uppercase eyebrow (Main, A2). Otherwise a 13 dp muted caption (B1, B2, B3). */
  eyebrow?: boolean;
  /** Right side: the Show text pill, the spoken time, the "Spoken today" chip. */
  right?: ReactNode;
  /** A session call is in flight: a small, quiet spinner after the text. */
  busy?: boolean;
  /** No model yet (canned mode): the quiet note under the row. */
  canned?: boolean;
  testID?: string;
}

/** The top line of every story screen (and, in canned mode, the note under it). */
export function MetaRow({ text, eyebrow = false, right, busy = false, canned = false, testID = 'story-meta' }: MetaRowProps) {
  const { t } = useI18n();
  const row = (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text
          variant={eyebrow ? 'eyebrow' : 'caption'}
          tone="muted"
          testID={testID}
          accessibilityRole="header"
          maxFontSizeMultiplier={CHROME_MAX_SCALE}
          style={styles.shrink}
        >
          {text}
        </Text>
        {busy ? <ActivityIndicator size="small" color={colors.muted} accessibilityLabel={t('story.busy')} testID="story-busy" /> : null}
      </View>
      {right}
    </View>
  );
  if (!canned) return row;
  return (
    <>
      {row}
      <CannedNote />
    </>
  );
}

/** "Spoken 4:15" at the right of the meta row. */
export function SpokenRight({ ms }: { ms: number }) {
  const { t } = useI18n();
  return (
    <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="story-spoken">
      {t('story.spoken', { time: clock(t, ms) })}
    </Text>
  );
}

/** "Spoken today 5:03" as a grey chip (A2). */
export function SpokenTodayChip({ ms }: { ms: number }) {
  const { t } = useI18n();
  return <Pill label={t('stats.spokenTodayClock', { time: clock(t, ms) })} testID="story-spoken-today" />;
}

/**
 * The text mode for the next press of the pill. From auto it hides the text when the look is
 * mostly text and shows it when mostly tiles (the previews' "Hide text" / "Show text"); from
 * all tiles it shows all text; from all text it goes back to auto (fade as you learn).
 */
export function nextTextMode(mode: TextMode, mostlyText: boolean): TextMode {
  if (mode === 'auto') return mostlyText ? 'all_tiles' : 'all_text';
  if (mode === 'all_tiles') return 'all_text';
  return 'auto';
}

const MODE_DESCRIPTION = {
  auto: 'settings.text.auto',
  all_text: 'settings.text.text',
  all_tiles: 'settings.text.tiles',
} as const;

export interface TextModePillProps {
  mode: TextMode;
  /** The sentence is mostly text right now (Ink look). */
  mostlyText: boolean;
  onChange: (mode: TextMode) => void;
}

/** "Hide text" / "Show text" / "Auto text": cycles the text mode (auto, all text, all tiles). */
export function TextModePill({ mode, mostlyText, onChange }: TextModePillProps) {
  const { t } = useI18n();
  const next = nextTextMode(mode, mostlyText);
  const label = next === 'all_tiles' ? t('text.hide') : next === 'all_text' ? t('text.show') : t('text.auto');
  return (
    <Pill
      label={label}
      accessibilityLabel={t('text.modeA11y', { action: label, current: t(MODE_DESCRIPTION[mode]) })}
      onPress={() => onChange(next)}
      testID="text-mode"
    />
  );
}

/** While the model is on its way the story runs on starter sentences: a quiet note, not an error. */
export function CannedNote() {
  const { t } = useI18n();
  return (
    <View style={styles.note} testID="story-canned">
      <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('story.canned')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 44 },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  shrink: { flexShrink: 1 },
  note: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.borderSoft,
  },
});
