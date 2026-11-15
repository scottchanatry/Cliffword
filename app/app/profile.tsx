import { StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useAppState } from '../src/appState/AppStateProvider';
import { useProfileStats } from '../src/features/profile/useProfileStats';
import { SettingsRow } from '../src/features/profile/SettingsRow';
import { usePairPack } from '../src/engine/PacksProvider';
import { clockParts, languageName, tKey, useI18n } from '../src/i18n';
import type { TextMode } from '../src/storage/repos/settings';
import { spacing } from '../src/theme';
import { Button, Card, ContentText, InterfaceText, Screen } from '../src/ui';

const TEXT_MODE_LABELS: Record<TextMode, string> = {
  auto: tKey('settings.text.auto'),
  text: tKey('settings.text.text'),
  tiles: tKey('settings.text.tiles'),
};

/** Profile and settings, presented as a modal from the corner button. Values come from storage. */
export default function ProfileScreen() {
  const { t, plural } = useI18n();
  const router = useRouter();
  const pair = usePairPack();
  const { settings } = useAppState();
  const stats = useProfileStats();
  const version = Constants.expoConfig?.version ?? '';

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} testID="profile-screen">
      <View style={styles.header}>
        <ContentText variant="title" accessibilityRole="header">
          {t('profile.title')}
        </ContentText>
        <Button variant="ghost" label={t('common.close')} onPress={() => router.back()} testID="close-profile" />
      </View>
      <Card>
        <InterfaceText variant="eyebrow" tone="muted">
          {t('stats.minutesSpoken')}
        </InterfaceText>
        <ContentText variant="display" tone="accent" testID="minutes-spoken">
          {t('time.clock', clockParts(stats.spokenMs))}
        </ContentText>
        <InterfaceText tone="muted">{plural('profile.wordsKnown', stats.wordsKnown)}</InterfaceText>
      </Card>
      <InterfaceText variant="eyebrow">{t('settings.title')}</InterfaceText>
      <Card style={styles.list}>
        <SettingsRow
          title={t('settings.text')}
          value={t(TEXT_MODE_LABELS[settings.textMode])}
          hint={t('settings.text.hint')}
          divider
        />
        <SettingsRow
          title={t('settings.explicit')}
          value={settings.showExplicit ? t('common.on') : t('common.off')}
          divider
          testID="settings-explicit"
        />
        <SettingsRow title={t('settings.nativeLanguage')} value={languageName(t, pair.native)} divider />
        <SettingsRow title={t('settings.targetLanguage')} value={languageName(t, pair.target)} />
      </Card>
      <InterfaceText variant="caption" tone="muted">
        {t('settings.version', { version })}
      </InterfaceText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, gap: 0 },
});
