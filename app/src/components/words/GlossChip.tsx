import { Text as Span, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { colors, fontFamilies, radii, spacing } from '../../theme';
import { CHROME_MAX_SCALE } from './fontScale';
import { TemplateText } from './TemplateText';

/**
 * The first sense of a pair-pack gloss ("stall, post, position" -> "stall"). Glosses are
 * native-language text listing senses with commas or semicolons, never target-language words.
 */
export function firstSense(gloss: string): string {
  const first = gloss.split(/[;,]/)[0]?.trim();
  return first && first.length > 0 ? first : gloss.trim();
}

export interface GlossChipProps {
  /** The word as written in the sentence (target language). */
  word: string;
  /** Its native gloss (pair pack). */
  gloss: string;
  testID?: string;
}

/** "puesto · stall · new for you" on the light amber of a new word. */
export function GlossChip({ word, gloss, testID }: GlossChipProps) {
  const { t } = useI18n();
  return (
    <View style={styles.chip} testID={testID}>
      <TemplateText
        variant="hint"
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        template={t('gloss.line')}
        values={{ word: <Span style={styles.word}>{word}</Span>, gloss: firstSense(gloss) }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.heat1,
  },
  word: { fontFamily: fontFamilies.interfaceSemiBold, color: colors.ink },
});
