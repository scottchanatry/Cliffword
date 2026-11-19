import { StyleSheet, View } from 'react-native';
import type { LibraryChoice } from '@cliffword/engine';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, InterfaceText } from '../../ui';
import { ChoiceCard } from './ChoiceCard';
import type { FlowContext } from './flow';
import { StepScreen } from './StepScreen';

export interface ChoicesStepViewProps {
  /** The experience's title ("Dating in Buenos Aires"). */
  experience: string;
  ctx: FlowContext;
  choices: readonly LibraryChoice[];
  /** Made so far: choice key -> option id. */
  chosen: Readonly<Record<string, string>>;
  saving: boolean;
  failed: boolean;
  onChoose: (key: string, optionId: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

/**
 * The experience's own questions before its first episode ("Who do you match with?"): one group of
 * cards per choice; Continue once each has an answer.
 */
export function ChoicesStepView({ experience, ctx, choices, chosen, saving, failed, onChoose, onContinue, onBack }: ChoicesStepViewProps) {
  const { t } = useI18n();
  const complete = choices.every((c) => chosen[c.key] !== undefined);
  return (
    <StepScreen
      step="choices"
      ctx={ctx}
      title={t('choices.title', { experience })}
      body={t('choices.body')}
      onBack={onBack}
      failed={failed}
      testID="onboarding-choices"
      footer={<Button label={t('common.continue')} onPress={onContinue} disabled={saving || !complete} testID="choices-continue" />}
    >
      {choices.map((choice) => (
        <View key={choice.key} style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={choice.prompt}>
          <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {choice.prompt}
          </InterfaceText>
          {choice.options.map((option) => (
            <ChoiceCard
              key={option.id}
              title={option.label}
              selected={chosen[choice.key] === option.id}
              disabled={saving}
              onPress={() => onChoose(choice.key, option.id)}
              testID={`choice-${choice.key}-${option.id}`}
            />
          ))}
        </View>
      ))}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.md },
});
