import { Redirect, useLocalSearchParams } from 'expo-router';
import { TapTimerView } from '../../../src/features/music/TapTimerView';
import { useTapTimer } from '../../../src/music/useTapTimer';

/** Time it while you listen: play the song and tap at each line start (?songId=). */
export default function TapTimerRoute() {
  const { songId } = useLocalSearchParams<{ songId?: string }>();
  const { props, source } = useTapTimer(songId ? String(songId) : null);
  if (!songId || source.status === 'missing' || source.status === 'needsLyrics') return <Redirect href="/music" />;
  return <TapTimerView {...props} />;
}
