import { useLocalSearchParams } from 'expo-router';
import { PasteLyricsView } from '../../../src/features/music/PasteLyricsView';
import { usePasteLyrics } from '../../../src/music/usePasteLyrics';

/** Paste lyrics (plain text or LRC) with a preview, for a new song or ?songId= of a stored one. */
export default function PasteLyricsRoute() {
  const { songId } = useLocalSearchParams<{ songId?: string }>();
  const props = usePasteLyrics(songId ? String(songId) : null);
  return <PasteLyricsView {...props} />;
}
