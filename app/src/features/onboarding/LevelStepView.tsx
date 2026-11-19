import { StyleSheet, View } from 'react-native';
import { tKey, useI18n, type CatalogKey } from '../../i18n';
import { spacing } from '../../theme';
import { ChoiceCard } from './ChoiceCard';
import type { FlowContext } from './flow';
import { StepScreen } from './StepScreen';

/** The three answers and the learner level each one starts at (0-1 recall, 2-3 hint, 4-5 predict). */
export const LEVEL_CHOICES: readonly { level: number; title: CatalogKey; hint: CatalogKey; id: string }[] = [
  { level: 0, id: 'new', title: tKey('level.brandNew'), hint: tKey('level.brandNew.hint') },
  { level: 2, id: 'little', title: tKey('level.aLittle'), hint: tKey('level.aLittle.hint') },
  { level: 4, id: 'comfortable', title: tKey('level.comfortable'), hint: tKey('level.comfortable.hint') },
];

export interface LevelStepViewProps {
  language: string;
  ctx: FlowContext;
  /** The level stored, shown as chosen when the learner comes back to this step. */
  level: number | null;
  saving: boolean;
  failed: boolean;
  onPick: (level: number) => void;
  onBack: () => void;
}

/** "How much Spanish do you know?": brand new, a little, comfortable. One tap chooses and goes on. */
export function LevelStepView({ language, ctx, level, saving, failed, onPick, onBack }: LevelStepViewProps) {
  const { t } = useI18n();
  return (
    <StepScreen
      step="level"
      ctx={ctx}
      title={t('level.title', { language })}
      body={t('level.body')}
      onBack={onBack}
      failed={failed}
      testID="onboarding-level"
    >
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel={t('level.title', { language })}>
        {LEVEL_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.id}
            title={t(choice.title)}
            subtitle={t(choice.hint, { language })}
            selected={level === choice.level}
            disabled={saving}
            onPress={() => onPick(choice.level)}
            testID={`level-${choice.id}`}
          />
        ))}
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
});
