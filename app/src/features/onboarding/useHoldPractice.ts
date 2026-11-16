/**
 * Onboarding's hold practice: hold anywhere on the practice card and say one of the six spoken
 * commands. The hold runs through the controllers' HoldToSpeak (permission at touch-down,
 * listening while held, the final transcript on release); the transcript is matched with the
 * engine's matchCommand on the language pack, and each command recognized is ticked off.
 * "Type instead" sends typed text through the same match. Nothing is scored or stored: practice
 * earns no minutes spoken.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchCommand, type SpokenCommand } from '@cliffword/engine';
import { useAppState } from '../../appState/AppStateProvider';
import type { HoldActions } from '../../components/voice/HoldAnywhere';
import { HoldToSpeak, LISTEN_IDLE } from '../../session/common/hold';
import { listenOptionsFor } from '../../session/common/listen';
import type { ListenState } from '../../session/contract';
import { useServices } from '../../services/ServicesProvider';

/** The six commands, in the order the practice lists them. */
export const PRACTICE_COMMANDS: readonly SpokenCommand[] = ['again', 'slower', 'dont_know', 'next', 'done', 'meaning'];

export interface PracticeHeard {
  text: string;
  /** The command it was, or null when it was none of the six. */
  command: SpokenCommand | null;
}

export interface HoldPractice {
  listen: ListenState;
  /** Commands said (or typed) so far, in PRACTICE_COMMANDS order. */
  practised: SpokenCommand[];
  /** The last thing heard, or null. */
  heard: PracticeHeard | null;
  actions: HoldActions;
  /** "Type instead": the typed text goes through the same match. */
  typed: (text: string) => void;
  /** Hear a command said by the story voice. */
  hear: (command: SpokenCommand) => void;
}

export function useHoldPractice(): HoldPractice {
  const { speechIn, speechOut, haptics, packs } = useServices();
  const { settings } = useAppState();
  const [listen, setListen] = useState<ListenState>(LISTEN_IDLE);
  const listenRef = useRef<ListenState>(LISTEN_IDLE);
  const [said, setSaid] = useState<ReadonlySet<SpokenCommand>>(() => new Set());
  const [heard, setHeard] = useState<PracticeHeard | null>(null);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const handle = useCallback(
    (text: string) => {
      const match = matchCommand(text, packs.lang);
      const command = match?.command ?? null;
      setHeard({ text, command });
      if (command) {
        haptics.play('success');
        setSaid((prev) => (prev.has(command) ? prev : new Set([...prev, command])));
      }
    },
    [packs, haptics],
  );

  const hold = useMemo(
    () =>
      new HoldToSpeak({
        speechIn,
        haptics,
        publish: (state) => {
          listenRef.current = state;
          setListen(state);
        },
        current: () => listenRef.current,
        onFinal: async (transcript) => handle(transcript.text),
        beforeListen: () => speechOut.stop().catch(() => undefined),
        listenOptions: () => {
          const s = settingsRef.current;
          const commandWords = PRACTICE_COMMANDS.flatMap((c) => packs.lang.commands?.find((e) => e.command === c)?.phrases ?? []);
          return { ...listenOptionsFor(packs.lang, s.regions, [], commandWords), onDevice: !s.allowNetworkRecognition };
        },
      }),
    [speechIn, speechOut, haptics, packs, handle],
  );
  useEffect(() => () => hold.dispose(), [hold]);

  const actions = useMemo<HoldActions>(
    () => ({
      holdBegin: () => hold.begin(),
      holdStart: () => hold.start(),
      holdEnd: () => hold.end(),
      holdCancel: () => hold.cancel(),
    }),
    [hold],
  );

  const hear = useCallback(
    (command: SpokenCommand) => {
      const phrase = packs.lang.commands?.find((e) => e.command === command)?.phrases[0];
      if (!phrase) return;
      void speechOut.speak(phrase, { lang: packs.lang.code, rate: 1 + settingsRef.current.speechRateBias }).catch(() => undefined);
    },
    [packs, speechOut],
  );

  const practised = PRACTICE_COMMANDS.filter((c) => said.has(c));
  return { listen, practised, heard, actions, typed: handle, hear };
}
