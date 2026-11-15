import { useRouter } from 'expo-router';
import { useI18n } from '../src/i18n';
import { Button, ContentText, Screen } from '../src/ui';

/** Unknown routes (deep links, typos). */
export default function NotFoundScreen() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} testID="not-found-screen">
      <ContentText variant="title" accessibilityRole="header">
        {t('error.notFound')}
      </ContentText>
      <Button label={t('error.goToStory')} onPress={() => router.replace('/')} />
    </Screen>
  );
}
