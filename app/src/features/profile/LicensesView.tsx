import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, InterfaceText, Screen } from '../../ui';
import { LICENSE_NAMES, LICENSES, type LicenseEntry } from './licenses';
import { LICENSE_TEXTS } from './licenseTexts';
import { ModalHeader } from './ModalHeader';

export interface LicensesViewProps {
  onBack: () => void;
}

/** Licenses: the model, the runtime, the fonts and the frameworks, each with its full license. */
export function LicensesView({ onBack }: LicensesViewProps) {
  const { t } = useI18n();
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} testID="licenses-screen">
      <ModalHeader title={t('licenses.title')} actionLabel={t('common.back')} onAction={onBack} placement="leading" actionTestID="licenses-back" />
      <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('licenses.intro')}
      </InterfaceText>
      {LICENSES.map((entry) => (
        <LicenseCard key={entry.id} entry={entry} />
      ))}
    </Screen>
  );
}

function LicenseCard({ entry }: { entry: LicenseEntry }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const license = LICENSE_NAMES[entry.license];
  return (
    <Card testID={`license-${entry.id}`}>
      <View style={styles.head}>
        <InterfaceText variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {entry.name}
        </InterfaceText>
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t(entry.role)}
        </InterfaceText>
      </View>
      <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {license}
      </InterfaceText>
      <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {entry.copyright}
      </InterfaceText>
      <InterfaceText variant="caption" tone="muted" selectable maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {entry.url}
      </InterfaceText>
      <Button
        variant="outline"
        label={open ? t('licenses.hideText') : t('licenses.showText')}
        accessibilityLabel={open ? t('licenses.hideTextFor', { license, name: entry.name }) : t('licenses.showTextFor', { license, name: entry.name })}
        onPress={() => setOpen((o) => !o)}
        testID={`license-${entry.id}-toggle`}
      />
      {open ? (
        <InterfaceText variant="caption" selectable maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`license-${entry.id}-text`}>
          {LICENSE_TEXTS[entry.license]}
        </InterfaceText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.xxs },
});
