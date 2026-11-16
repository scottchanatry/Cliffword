import { StyleSheet } from 'react-native';
import { useI18n } from '../../i18n';
import { Card, Screen } from '../../ui';
import { LinkRow } from './LinkRow';
import { MinutesHeadline } from './MinutesHeadline';
import { ModalHeader } from './ModalHeader';
import type { ProfileStats } from './useProfileStats';
import { WordsCard } from './WordsCard';

export interface ProfileViewProps {
  stats: Pick<ProfileStats, 'spokenMs' | 'todayMs' | 'week' | 'streakDays' | 'wordsKnown' | 'skills'>;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** Profile (modal from the corner button): minutes spoken first, then words and the skill mix. */
export function ProfileView({ stats, onOpenSettings, onClose }: ProfileViewProps) {
  const { t } = useI18n();
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} testID="profile-screen">
      <ModalHeader title={t('profile.title')} actionLabel={t('common.close')} onAction={onClose} actionTestID="close-profile" />
      <MinutesHeadline todayMs={stats.todayMs} totalMs={stats.spokenMs} week={stats.week} streakDays={stats.streakDays} />
      <WordsCard wordsKnown={stats.wordsKnown} skills={stats.skills} />
      <Card style={styles.links}>
        <LinkRow title={t('settings.title')} hint={t('profile.settings.hint')} onPress={onOpenSettings} testID="open-settings" />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  links: { paddingVertical: 0, gap: 0 },
});
