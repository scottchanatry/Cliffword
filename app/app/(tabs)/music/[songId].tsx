import { useEffect, useRef } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { NeedsLyricsView } from '../../../src/features/music/NeedsLyricsView';
import { SongView } from '../../../src/features/music/SongView';
import { useLyricController } from '../../../src/session/lyric/useLyricController';

type Mode = 'read' | 'cliff' | 'echo';

/** Back to the library (in this stack, or opened there when the song came from a link). */
const back = () => router.dismissTo('/music');

/**
 * A song page: the lyric controller's screen as it is (read A3, cliff C1, result, no sé, echo
 * B4, registers, done). ?mode=cliff opens the next line's cliff, ?mode=echo the sing-back of the
 * current line, once the song has opened. A song without lyrics asks for them.
 */
export default function SongRoute() {
  const params = useLocalSearchParams<{ songId: string; mode?: Mode }>();
  const songId = String(params.songId ?? '');
  const { vm, actions, source } = useLyricController(songId ? { kind: 'song', songId } : null);

  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !vm.screen) return;
    applied.current = true;
    if (params.mode === 'cliff' && vm.screen.kind === 'read') actions.next();
    else if (params.mode === 'echo') actions.startEcho();
  }, [vm.screen, params.mode, actions]);

  if (source.status === 'missing') return <Redirect href="/music" />;
  if (source.status === 'needsLyrics') {
    return (
      <NeedsLyricsView
        title={source.title}
        artist={source.artist}
        onPaste={() => router.push({ pathname: '/music/paste', params: { songId } })}
        onBack={back}
      />
    );
  }
  return (
    <SongView
      vm={vm}
      actions={actions}
      nav={{
        onEditLyrics: () => router.push({ pathname: '/music/paste', params: { songId } }),
        ...(vm.playback.available ? { onTimeIt: () => router.push({ pathname: '/music/time', params: { songId } }) } : {}),
        onOpenRegisters: () => router.push({ pathname: '/music/registers', params: { songId } }),
        onBack: back,
      }}
    />
  );
}
