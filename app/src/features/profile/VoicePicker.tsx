import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { Voice } from '../../adapters/speechOut/types';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, layout, spacing } from '../../theme';
import { Button, InterfaceText } from '../../ui';

export interface VoicePickerProps {
  /** null while loading. */
  voices: Voice[] | null;
  /** settings.voiceId (null: automatic). */
  selected: string | null;
  onSelect: (voiceId: string | null) => void;
  onPlay: () => void;
  playing: boolean;
  canSample: boolean;
  /** The target language's name, for the automatic row and the empty state. */
  language: string;
  testID?: string;
}

/**
 * The story voice: "Automatic" (picked by region, as the story does) and the installed voices,
 * as radio rows, then "Play a sample" with the chosen one.
 */
export function VoicePicker({ voices, selected, onSelect, onPlay, playing, canSample, language, testID = 'voice-picker' }: VoicePickerProps) {
  const { t } = useI18n();
  if (voices === null) {
    return <ActivityIndicator color={colors.muted} accessibilityLabel={t('voice.loading')} testID={`${testID}-loading`} />;
  }
  const selectedExists = selected !== null && voices.some((v) => v.id === selected);
  const current = selectedExists ? selected : null;
  return (
    <View style={styles.box} testID={testID}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('voice.title')}>
        <VoiceRow
          title={t('voice.auto')}
          hint={t('voice.auto.hint', { language })}
          checked={current === null}
          onPress={() => onSelect(null)}
          divider={voices.length > 0}
          testID={`${testID}-auto`}
        />
        {voices.map((voice, i) => (
          <VoiceRow
            key={voice.id}
            title={voice.name}
            hint={voice.quality === 'enhanced' ? t('voice.enhanced', { lang: voice.lang }) : voice.lang}
            checked={current === voice.id}
            onPress={() => onSelect(voice.id)}
            divider={i < voices.length - 1}
            testID={`${testID}-${voice.id}`}
          />
        ))}
      </View>
      {voices.length === 0 ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('voice.none', { language })}
        </InterfaceText>
      ) : null}
      {canSample ? (
        <Button
          variant="outline"
          label={playing ? t('voice.playing') : t('voice.sample')}
          onPress={onPlay}
          disabled={playing}
          testID={`${testID}-sample`}
        />
      ) : null}
    </View>
  );
}

function VoiceRow({ title, hint, checked, onPress, divider, testID }: { title: string; hint: string; checked: boolean; onPress: () => void; divider: boolean; testID: string }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ checked }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      <View style={[styles.radio, checked && styles.radioOn]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {checked ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.text}>
        <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </InterfaceText>
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {hint}
        </InterfaceText>
      </View>
    </Pressable>
  );
}

const RADIO = 22;

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  row: { minHeight: layout.primaryHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  divider: { borderBottomWidth: borders.hairline, borderBottomColor: colors.borderSoft },
  pressed: { opacity: 0.7 },
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: RADIO / 2,
    borderWidth: borders.strong,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.ink },
  dot: { width: RADIO / 2, height: RADIO / 2, borderRadius: RADIO / 4, backgroundColor: colors.ink },
  text: { flex: 1, gap: spacing.xxs },
});
