import { StyleSheet, View } from 'react-native';
import { useSettings } from '../../src/appState/AppStateProvider';
import { RegionPills, type RegionCode } from '../../src/features/music/RegionPills';
import { SourceRow } from '../../src/features/music/SourceRow';
import { useI18n } from '../../src/i18n';
import { radii, spacing } from '../../src/theme';
import { Button, Card, InterfaceText, MusicHeading, Screen } from '../../src/ui';

/**
 * Music tab in the Music look: sources (actions arrive in the Music stage), and the slang regions
 * and explicit-lyrics choices, which are stored settings.
 */
export default function MusicScreen() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSettings();
  const regions = settings.regions;
  const explicit = settings.showExplicit;
  const toggleRegion = (code: RegionCode) =>
    void updateSettings({ regions: regions.includes(code) ? regions.filter((c) => c !== code) : [...regions, code] });

  return (
    <Screen scroll testID="music-screen">
      <MusicHeading>{t('music.title')}</MusicHeading>
      <Card style={styles.list}>
        <SourceRow
          title={t('music.appleMusic')}
          hint={t('music.appleMusic.disconnected')}
          actionLabel={t('action.connect')}
          divider
          testID="source-apple-music"
        />
        <SourceRow
          title={t('music.spotify')}
          hint={t('music.spotify.hint')}
          actionLabel={t('action.showMe')}
          divider
          testID="source-spotify"
        />
        <SourceRow
          title={t('music.lyrics')}
          hint={t('music.lyrics.hint')}
          actionLabel={t('action.paste')}
          primary
          testID="source-lyrics"
        />
      </Card>
      <InterfaceText variant="eyebrow">{t('music.slangToLearn')}</InterfaceText>
      <RegionPills selected={regions} onToggle={toggleRegion} />
      <Card style={styles.explicit}>
        <View style={styles.explicitText}>
          <InterfaceText variant="rowTitle">{t('music.explicit.title')}</InterfaceText>
          <InterfaceText variant="caption" tone="muted">
            {explicit ? t('music.explicit.onHint') : t('music.explicit.offHint')}
          </InterfaceText>
        </View>
        <Button
          variant="outline"
          label={explicit ? t('action.turnOff') : t('action.turnOn')}
          onPress={() => void updateSettings({ showExplicit: !explicit })}
          testID="toggle-explicit"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, gap: 0, borderRadius: radii.list },
  explicit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.list,
  },
  explicitText: { flex: 1, gap: spacing.xxs },
});
