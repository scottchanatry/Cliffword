import { StyleSheet, View } from 'react-native';
import type { CliffPrompt } from '@cliffword/engine';
import { HoldButton } from '../../components/voice/HoldButton';
import { ListenStatus } from '../../components/voice/ListenStatus';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import type { ListenState } from '../../session/contract';
import { spacing } from '../../theme';
import { Button, Card, InterfaceText } from '../../ui';
import { HintRung, NativeAllowedChip, OptionsRung, rungLine } from './Rungs';

export interface CliffCardProps {
  /** The engine's cliff prompt (rung, options, hint). Without it: the generic "any natural answer" line. */
  cliff?: CliffPrompt;
  listen?: ListenState;
  /** Toggle listening (the hold button's screen-reader action). */
  onToggleListen?: () => void;
  onTypeInstead?: () => void;
  onHearAgain?: () => void;
  /** "Skip": the no-sé flow (hear the answer, then repeat it). */
  onSkip?: () => void;
  onPickOption?: (index: number) => void;
  /** Option being read aloud (lit), if known. */
  speakingOption?: number | null;
}

const IDLE: ListenState = { phase: 'idle' };

/**
 * "Say what comes next" (the Ink look, Main): the rung's line, the options or the hint, the
 * ink "Hold to speak" button (holding anywhere works the same), and Type instead / Hear it
 * again / Skip.
 */
export function CliffCard({ cliff, listen = IDLE, onToggleListen, onTypeInstead, onHearAgain, onSkip, onPickOption, speakingOption }: CliffCardProps) {
  const { t, plural } = useI18n();
  const subtitle = cliff ? rungLine(t, plural, cliff) : t('cliff.subtitle');
  return (
    <Card testID="cliff-card">
      <InterfaceText variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('cliff.title')}
      </InterfaceText>
      <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="cliff-rung-line">
        {subtitle}
      </InterfaceText>
      {cliff?.rung === 'options' && cliff.options && onPickOption ? (
        <OptionsRung options={cliff.options} onPick={onPickOption} speakingOption={speakingOption} />
      ) : null}
      {cliff?.rung === 'hint' && cliff.hint ? <HintRung hint={cliff.hint} /> : null}
      {cliff?.nativeAllowed && cliff.rung !== 'free' ? <NativeAllowedChip /> : null}
      <ListenStatus listen={listen} />
      <HoldButton label={t('action.holdToSpeak')} listen={listen} onToggle={onToggleListen ?? noop} />
      <View style={styles.row}>
        <Button variant="ghost" label={t('action.typeInstead')} onPress={onTypeInstead} testID="type-instead" />
        <Button variant="ghost" label={t('action.hearAgain')} onPress={onHearAgain} testID="hear-again" />
        <Button variant="ghost" muted label={t('action.skip')} onPress={onSkip} testID="skip" />
      </View>
    </Card>
  );
}

function noop() {}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -spacing.sm },
});
