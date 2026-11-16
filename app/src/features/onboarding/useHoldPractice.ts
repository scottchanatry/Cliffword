/**
 * Onboarding's hold practice: hold anywhere on the practice card and say one of the six spoken
 * commands. The hold runs through the controllers' HoldToSpeak (permission at touch-down,
 * listening while held, the final transcript on release); the transcript is matched with the
 * engine's matchCommand on the language pack, and each command recognized is ticked off.
 * "Type instead" sends typed text through the same match. Nothing is scored or stored: practice
 * earns no minutes spoken.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { matchCommand, type LanguagePack, type SpokenCommand } from '@cliffword/engine';
import type { Haptics } from '../../adapters/haptics/types';
import type { SpeechIn } from '../../adapters/speechIn/types';
import type { SpeechOut } from '../../adapters/speechOut/types';
import { useAppState } from '../../appState/AppStateProvider';
import type { HoldActions } from '../../components/voice/HoldAnywhere';
import { HoldToSpeak, LISTEN_IDLE } from '../../session/common/hold';
import { listenOptionsFor } from '../../session/common/listen';
import type { ListenState } from '../../session/contract';
import { useServices } from '../../services/ServicesProvider';
import type { AppSettings } from '../../storage/repos/settings';

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

interface PracticeState {
  listen: ListenState;
  practised: SpokenCommand[];
  heard: PracticeHeard | null;
}

const INITIAL: PracticeState = { listen: LISTEN_IDLE, practised: [], heard: null };

export interface PracticeDeps {
  speechIn: SpeechIn;
  speechOut: SpeechOut;
  haptics: Haptics;
  pack: LanguagePack;
  /** The current settings (regions, network recognition, speed, voice). */
  settings: () => AppSettings;
}

/** The practice outside React: a hold, the commands said, and a snapshot for useSyncExternalStore. */
export class PracticeSession {
  private state: PracticeState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly hold: HoldToSpeak;
  readonly actions: HoldActions;

  constructor(private readonly deps: PracticeDeps) {
    this.hold = new HoldToSpeak({
      speechIn: deps.speechIn,
      haptics: deps.haptics,
      publish: (listen) => this.set({ listen }),
      current: () => this.state.listen,
      onFinal: async (transcript) => this.typed(transcript.text),
      beforeListen: () => deps.speechOut.stop().catch(() => undefined),
      listenOptions: () => {
        const s = deps.settings();
        const phrases = PRACTICE_COMMANDS.flatMap((c) => deps.pack.commands?.find((e) => e.command === c)?.phrases ?? []);
        return { ...listenOptionsFor(deps.pack, s.regions, [], phrases), onDevice: !s.allowNetworkRecognition };
      },
    });
    this.actions = {
      holdBegin: () => this.hold.begin(),
      holdStart: () => this.hold.start(),
      holdEnd: () => this.hold.end(),
      holdCancel: () => this.hold.cancel(),
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PracticeState => this.state;

  /** A transcript (spoken or typed): which command it was, if any. */
  typed = (text: string): void => {
    const command = matchCommand(text, this.deps.pack)?.command ?? null;
    if (command) this.deps.haptics.play('success');
    const said = command && !this.state.practised.includes(command) ? [...this.state.practised, command] : this.state.practised;
    this.set({ heard: { text, command }, practised: PRACTICE_COMMANDS.filter((c) => said.includes(c)) });
  };

  hear = (command: SpokenCommand): void => {
    const phrase = this.deps.pack.commands?.find((e) => e.command === command)?.phrases[0];
    if (!phrase) return;
    const s = this.deps.settings();
    void this.deps.speechOut
      .speak(phrase, { lang: this.deps.pack.code, rate: 1 + s.speechRateBias, ...(s.voiceId ? { voice: s.voiceId } : {}) })
      .catch(() => undefined);
  };

  dispose(): void {
    this.hold.dispose();
    this.listeners.clear();
  }

  private set(patch: Partial<PracticeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

const noop = () => undefined;
const NO_ACTIONS: HoldActions = { holdBegin: noop, holdStart: noop, holdEnd: noop, holdCancel: noop };
const subscribeNone = () => noop;
const initialSnapshot = () => INITIAL;

export function useHoldPractice(): HoldPractice {
  const { speechIn, speechOut, haptics, packs } = useServices();
  const { settings } = useAppState();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const [session, setSession] = useState<PracticeSession | null>(null);
  useEffect(() => {
    const s = new PracticeSession({ speechIn, speechOut, haptics, pack: packs.lang, settings: () => settingsRef.current });
    setSession(s);
    return () => s.dispose();
  }, [speechIn, speechOut, haptics, packs]);

  const state = useSyncExternalStore(session?.subscribe ?? subscribeNone, session?.getSnapshot ?? initialSnapshot, session?.getSnapshot ?? initialSnapshot);
  return {
    ...state,
    actions: session?.actions ?? NO_ACTIONS,
    typed: session?.typed ?? noop,
    hear: session?.hear ?? noop,
  };
}
