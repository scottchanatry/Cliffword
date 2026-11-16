import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, fontFamilies, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { LyricLine } from './LyricLine';
import type { LineWord } from './lyricWords';

export interface RegisterPairCardProps {
  /** neutral: white card ("Neutral · works anywhere"). street: ink card with the amber label. */
  register: 'neutral' | 'street';
  /** The label, already translated ("Street · Puerto Rico, with friends"). */
  label: string;
  /** The line's words (explicit words masked when explicit lyrics are off). */
  words: readonly LineWord[];
  /** The register the learner practises now. */
  current?: boolean;
  testID?: string;
}

/** One side of "Same idea, two ways to say it" (C2). */
export function RegisterPairCard({ register, label, words, current = false, testID }: RegisterPairCardProps) {
  const street = register === 'street';
  return (
    <View
      style={[styles.card, street ? styles.street : styles.neutral]}
      testID={testID ?? `register-card-${register}`}
      accessibilityState={{ selected: current }}
    >
      <Text variant="eyebrow" style={[styles.label, { color: street ? colors.heat2 : colors.muted }]} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {label}
      </Text>
      <LyricLine words={words} look="card" onInk={street} underlineSlang={false} testID={`${testID ?? `register-card-${register}`}-line`} />
    </View>
  );
}

/** "amigos → corillo": what changes between the two registers, as static chips. */
export function SwapList({ swaps, testID = 'swap-list' }: { swaps: readonly { from: string; to: string }[]; testID?: string }) {
  const { t } = useI18n();
  if (swaps.length === 0) return null;
  return (
    <View style={styles.swaps} testID={testID} accessible accessibilityLabel={t('register.swaps')}>
      {swaps.map((s, i) => (
        <View key={`${s.from}-${s.to}-${i}`} style={styles.swap} testID={`${testID}-${i}`}>
          <Text variant="pillStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('register.fromTo', { from: s.from, to: s.to })}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs + 2, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg + 2, borderRadius: radii.list },
  neutral: { backgroundColor: colors.card },
  street: { backgroundColor: colors.ink },
  label: { fontFamily: fontFamilies.interfaceBold },
  swaps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swap: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderWidth: borders.strong, borderColor: colors.ink, borderRadius: radii.pill },
});
