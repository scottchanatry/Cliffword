/**
 * Speech helpers of the lyric controller: the words the recognizer should expect on a lyric
 * screen, and the cue that plays the current screen again after a restart. Words come from the
 * language pack's segmenter, never from splitting on spaces.
 */
import type { LanguagePack, LyricScreen, SpeakCue } from '@cliffword/engine';
import { wordSpansOf } from '../common/speaker';

/** Words and phrases to pass as recognizer hints (the pack's commands are added by listenOptionsFor). */
export function lyricHintWords(pack: Pick<LanguagePack, 'segment'>, screen: LyricScreen | null): string[] {
  if (!screen) return [];
  const out: string[] = [];
  const words = (text: string | null | undefined) => {
    if (text) for (const w of wordSpansOf(pack, text)) out.push(w.text);
  };
  switch (screen.kind) {
    case 'cliff':
      words(screen.before);
      for (const o of screen.options ?? []) out.push(o.text);
      break;
    case 'line':
      words(screen.line.text);
      break;
    case 'result':
      words(screen.line);
      break;
    case 'noSe':
      out.push(screen.answer);
      words(screen.answer);
      break;
    case 'nativeReply':
      if (screen.target) out.push(screen.target);
      break;
    case 'echo':
      words(screen.line);
      break;
    case 'registers':
      for (const p of screen.pairs) {
        words(p.street);
        words(p.neutral);
      }
      break;
    default:
      break;
  }
  return out;
}

/** The text of the screen's current line, when it shows one. */
export function lineTextOf(screen: LyricScreen | null): string | null {
  if (!screen) return null;
  switch (screen.kind) {
    case 'line':
      return screen.line.text;
    case 'result':
    case 'echo':
      return screen.line;
    default:
      return null;
  }
}

/**
 * The cue that plays the screen again when the step's own cue is gone (after a restart): the
 * line up to the gap, the answer to hear, the target phrase, or the line.
 */
export function lyricCueForScreen(screen: LyricScreen | null): SpeakCue | null {
  if (!screen) return null;
  switch (screen.kind) {
    case 'cliff':
      return screen.before.trim() ? { text: screen.before.trimEnd(), rate: 1, what: 'line' } : null;
    case 'noSe':
      return { text: screen.answer, rate: 1, what: 'answer' };
    case 'nativeReply':
      return screen.target ? { text: screen.target, rate: 1, what: 'answer' } : null;
    default: {
      const line = lineTextOf(screen);
      return line ? { text: line, rate: 1, what: 'line' } : null;
    }
  }
}
