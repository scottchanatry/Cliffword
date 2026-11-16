/**
 * "Time it while you listen" (route (tabs)/music/time?songId=): the learner plays the song and
 * taps at the start of each line. Each tap is the controller's markLine(index, position), so the
 * song's session pauses at those starts from then on (LinePlay mode 'tapped'). Uses the song's
 * shared controller (LyricControllersProvider), the same one the song page shows.
 */
import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import type { TapTimerProps } from '../features/music/types';
import { useLyricController, type UseLyricController } from '../session/lyric/useLyricController';
import type { TimingLine } from '../session/lyric/createLyricController';

/** A nudge moves a tapped start by this much. */
export const NUDGE_MS = 250;

export interface UseTapTimer {
  props: TapTimerProps;
  source: UseLyricController['source'];
}

export function useTapTimer(songId: string | null): UseTapTimer {
  const { vm, actions, source, controller } = useLyricController(songId ? { kind: 'song', songId } : null);
  const [lines, setLines] = useState<TimingLine[]>([]);
  const [current, setCurrent] = useState(0);
  const [started, setStarted] = useState(false);

  // The lines (and tapped starts) as the session holds them, refreshed after every step.
  useEffect(() => {
    if (!controller) return;
    const read = () => setLines(controller.timingLines());
    read();
    return controller.subscribe(read);
  }, [controller]);

  const tap = useCallback(() => {
    if (!controller || current >= lines.length) return;
    actions.markLine(current, controller.positionMs());
    setCurrent((c) => Math.min(lines.length, c + 1));
  }, [controller, current, lines.length, actions]);

  const meta = vm.screen?.meta;
  return {
    source,
    props: {
      title: meta?.title ?? '',
      artist: meta?.artist ?? '',
      lines,
      current,
      playback: vm.playback,
      onPlay: () => {
        if (!controller) return;
        if (started) actions.play();
        else {
          setStarted(true);
          controller.playFrom(0);
        }
      },
      onPause: actions.pause,
      onTap: tap,
      onNudge: (index, deltaMs) => {
        const start = lines.find((l) => l.index === index)?.startMs;
        if (start === null || start === undefined) return;
        actions.markLine(index, Math.max(0, start + deltaMs));
      },
      onUndo: () => setCurrent((c) => Math.max(0, c - 1)),
      onDone: () => {
        actions.pause();
        if (songId) router.dismissTo({ pathname: '/music/[songId]', params: { songId } });
        else router.dismissTo('/music');
      },
    },
  };
}
