import { useLocalSearchParams } from 'expo-router';
import { ShareConfirmView } from '../../../src/features/music/ShareConfirmView';
import { useShareConfirm } from '../../../src/music/useShareConfirm';

/** Confirm a song shared from another app (Spotify), then paste its lyrics. ?id= is the shared item. */
export default function ShareConfirmRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const props = useShareConfirm(id ? String(id) : null);
  return <ShareConfirmView {...props} />;
}
