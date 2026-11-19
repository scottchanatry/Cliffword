import { StyleSheet, View } from 'react-native';
import type { Address } from '../../storage/repos/settings';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { ChoiceCard } from './ChoiceCard';
import type { FlowContext } from './flow';
import { StepScreen } from './StepScreen';

export interface AddressStepViewProps {
  language: string;
  ctx: FlowContext;
  /** A line of the story said to a man and to a woman ("¡Buenos días, vecino!" / "vecina"), or null. */
  example: Record<Address, string> | null;
  /** The address stored, when the learner comes back to this step. */
  address: Address | null;
  saving: boolean;
  failed: boolean;
  onPick: (address: Address) => void;
  onBack: () => void;
}

/** "How should people address you?": as a man or as a woman, with why (words change with gender). */
export function AddressStepView({ language, ctx, example, address, saving, failed, onPick, onBack }: AddressStepViewProps) {
  const { t } = useI18n();
  return (
    <StepScreen
      step="address"
      ctx={ctx}
      title={t('address.title')}
      body={t('address.body', { language })}
      onBack={onBack}
      failed={failed}
      testID="onboarding-address"
    >
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel={t('address.title')}>
        <ChoiceCard
          title={t('address.man')}
          sample={example?.m}
          selected={address === 'm'}
          disabled={saving}
          onPress={() => onPick('m')}
          testID="address-m"
        />
        <ChoiceCard
          title={t('address.woman')}
          sample={example?.f}
          selected={address === 'f'}
          disabled={saving}
          onPress={() => onPick('f')}
          testID="address-f"
        />
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
});
