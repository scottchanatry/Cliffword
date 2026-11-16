import { StyleSheet, View } from 'react-native';
import type { AlignmentView } from '@cliffword/engine';
import { useI18n } from '../../i18n';
import { borders, colors, fontFamilies, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { CHROME_MAX_SCALE } from './fontScale';

/**
 * "Understood 6 of 7 words" after a repeat or a shadowed line, with the expected words:
 * those that landed in ink, the missed ones hollow. A count of words understood, never an
 * accent score.
 */
export function UnderstoodLine({ alignment, testID = 'understood' }: { alignment: AlignmentView; testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.box} testID={testID}>
      <Text variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} accessibilityLiveRegion="polite">
        {t(alignment.ui.key, alignment.ui.params)}
      </Text>
      <View style={styles.words}>
        {alignment.words.map((w, i) => (
          <View
            key={`${i}-${w.text}`}
            style={[styles.word, w.landed ? styles.landed : styles.missed]}
            accessible
            accessibilityLabel={w.landed ? w.text : t('understood.missed', { word: w.text })}
            testID={`understood-${i}-${w.landed ? 'landed' : 'missed'}`}
          >
            <Text style={[styles.wordText, !w.landed && styles.missedText]} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {w.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  word: { height: 30, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.tile },
  landed: { backgroundColor: colors.ink },
  missed: { borderWidth: borders.hairline, borderStyle: 'dashed', borderColor: colors.borderDashed },
  wordText: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 14, lineHeight: 18, color: colors.onInk },
  missedText: { color: colors.muted },
});
