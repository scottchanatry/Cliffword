import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SongView } from '../../src/features/music/SongView';
import { useLyricController } from '../../src/session/lyric/useLyricController';

const back = () => (router.canGoBack() ? router.back() : router.replace('/music'));

/** A brought text: the lyric session over the text (source 'text'): surprise shading, cliffs, no sé, minutes spoken. */
export default function BroughtTextRoute() {
  const { textId } = useLocalSearchParams<{ textId: string }>();
  const id = String(textId ?? '');
  const { vm, actions, source } = useLyricController(id ? { kind: 'text', textId: id } : null);
  if (source.status === 'missing') return <Redirect href="/music" />;
  return <SongView vm={vm} actions={actions} nav={{ onBack: back }} />;
}
