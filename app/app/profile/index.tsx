import { useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ProfileView } from '../../src/features/profile/ProfileView';
import { useProfileStats } from '../../src/features/profile/useProfileStats';

/** Profile (modal from the corner button): minutes spoken, words understood, the skill mix. */
export default function ProfileScreen() {
  const router = useRouter();
  const stats = useProfileStats();
  const { refresh } = stats;
  // Coming back from settings (or after speaking in another tab) reads the minutes again.
  useFocusEffect(useCallback(() => refresh(), [refresh]));
  return <ProfileView stats={stats} onOpenSettings={() => router.push('/profile/settings')} onClose={() => router.back()} />;
}
