import { StyleSheet, View } from 'react-native';
import { leadAfter, type SaidWord } from '@cliffword/engine';
import { useI18n, type CatalogKey } from '../../i18n';
import { colors, heatColors, radii, spacing, typography } from '../../theme';
import { Text } from '../../ui';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from './fontScale';

const HEAT_LEVEL_KEYS: Record<1 | 2 | 3, CatalogKey> = {
  1: 'heat.level.1',
  2: 'heat.level.2',
  3: 'heat.level.3',
};

export interface HeatSentenceProps {
  /** The learner's own words with their heat (0 expected .. 3 most surprising). */
  said: readonly SaidWord[];
  /** The word the repair is about (index into said), drawn strongest. */
  highlight?: number | null;
  testID?: string;
}

/**
 * "You said": the learner's sentence with each word shaded by how surprising it was, on the
 * amber scale (heat 1 #FFE9C7, 2 #FFC46B, 3 #F08A1D; 0 unshaded). The words come from the
 * engine's segmenter; between two words goes the space the script uses (engine leadAfter:
 * none in scripts written without spaces). Heat is named for screen readers, not only colored.
 */
export function HeatSentence({ said, highlight = null, testID = 'heat-sentence' }: HeatSentenceProps) {
  const { t } = useI18n();
  return (
    <View style={styles.row} testID={testID}>
      {said.map((w, i) => {
        const flagged = highlight === i;
        const heat = (flagged ? Math.max(2, w.heat) : w.heat) as 0 | 1 | 2 | 3;
        const bg = heatColors[heat];
        const sep = i < said.length - 1 ? leadAfter(w.text) : '';
        const label =
          heat === 0
            ? w.text
            : flagged
              ? t('heat.flagged', { word: w.text })
              : t('heat.wordLabel', { word: w.text, level: t(HEAT_LEVEL_KEYS[heat]) });
        return (
          <View key={`${i}-${w.text}`} style={styles.cell} accessible accessibilityLabel={label} testID={`said-${i}`}>
            <Text
              variant="prompt"
              maxFontSizeMultiplier={CONTENT_MAX_SCALE}
              testID={`said-${i}-word`}
              style={[styles.word, bg ? [styles.shaded, { backgroundColor: bg }] : null]}
            >
              {w.text}
            </Text>
            {sep ? (
              <Text variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE} style={styles.word}>
                {sep}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** "expected [light] [mid] [strong] surprising". */
export function HeatLegend({ testID = 'heat-legend' }: { testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.legend} testID={testID} accessible accessibilityLabel={t('heat.legend.a11y')}>
      <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('heat.expected')}
      </Text>
      {[1, 2, 3].map((h) => (
        <View key={h} style={[styles.swatch, { backgroundColor: heatColors[h] ?? undefined }]} />
      ))}
      <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('heat.surprising')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: spacing.xxs },
  cell: { flexDirection: 'row', alignItems: 'center' },
  word: { fontSize: typography.prompt.fontSize, lineHeight: 34 },
  shaded: { paddingHorizontal: 5, borderRadius: radii.tile - 1, overflow: 'hidden', color: colors.ink },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 22, height: 12, borderRadius: 3 },
});
