import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { colors } from '../../theme';
import { Button, Card, InterfaceText } from '../../ui';

export interface CliffCardProps {
  onHoldToSpeak?: () => void;
  onTypeInstead?: () => void;
  onHearAgain?: () => void;
  onSkip?: () => void;
}

/** "Say what comes next" card from the Ink preview. Actions arrive in the Story stage. */
export function CliffCard({ onHoldToSpeak, onTypeInstead, onHearAgain, onSkip }: CliffCardProps) {
  const { t } = useI18n();
  return (
    <Card testID="cliff-card">
      <InterfaceText variant="cardTitle" accessibilityRole="header">
        {t('cliff.title')}
      </InterfaceText>
      <InterfaceText tone="muted">{t('cliff.subtitle')}</InterfaceText>
      <Button
        label={t('action.holdToSpeak')}
        accessibilityHint={t('action.holdToSpeak.hint')}
        onLongPress={onHoldToSpeak}
        icon={<MicGlyph />}
      />
      <View style={styles.row}>
        <Button variant="ghost" label={t('action.typeInstead')} onPress={onTypeInstead} />
        <Button variant="ghost" label={t('action.hearAgain')} onPress={onHearAgain} />
        <Button variant="ghost" muted label={t('action.skip')} onPress={onSkip} />
      </View>
    </Card>
  );
}

/** A small microphone drawn with views (white on the ink button). */
function MicGlyph() {
  return (
    <View style={styles.mic}>
      <View style={styles.micHead} />
      <View style={styles.micStand} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  mic: { alignItems: 'center', width: 20, height: 20, justifyContent: 'center' },
  micHead: { width: 8, height: 12, borderRadius: 4, borderWidth: 2, borderColor: colors.onInk },
  micStand: { width: 2, height: 5, backgroundColor: colors.onInk },
});
