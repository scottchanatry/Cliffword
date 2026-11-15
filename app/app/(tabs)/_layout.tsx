import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileButton } from '../../src/components/ProfileButton';
import { TabIcon } from '../../src/components/TabIcon';
import { useI18n } from '../../src/i18n';
import { colors, layout, typography } from '../../src/theme';
import { Text } from '../../src/ui';

function HeaderTitle() {
  const { t } = useI18n();
  return (
    <Text variant="brand" accessibilityRole="header">
      {t('app.name')}
    </Text>
  );
}

/** Tab bar content height above the safe area: icon, label and padding without clipping. */
const TAB_BAR_HEIGHT = 60;

export default function TabsLayout() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerTitle: () => <HeaderTitle />,
        headerTitleAlign: 'left',
        headerRight: () => <ProfileButton />,
        headerRightContainerStyle: { paddingRight: layout.screenPaddingX },
        headerTitleContainerStyle: { marginHorizontal: 0, paddingLeft: layout.screenPaddingX },
        headerStyle: { backgroundColor: colors.ground },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.ground },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: typography.tab.fontFamily, fontSize: typography.tab.fontSize },
        tabBarStyle: {
          height: TAB_BAR_HEIGHT + insets.bottom,
          backgroundColor: colors.ground,
          borderTopColor: colors.borderSoft,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.story'),
          tabBarIcon: ({ color }) => <TabIcon name="story" color={color} />,
          tabBarButtonTestID: 'tab-story',
        }}
      />
      <Tabs.Screen
        name="music"
        options={{
          title: t('tab.music'),
          tabBarIcon: ({ color }) => <TabIcon name="music" color={color} />,
          tabBarButtonTestID: 'tab-music',
        }}
      />
    </Tabs>
  );
}
