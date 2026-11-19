/**
 * Speech helpers for the story controller. Words always come from the language pack's
 * segmenter (never from splitting on spaces): a ViewWord's index is its position among the
 * word and number segments of the sentence (engine sentenceWords), so the same segmentation
 * maps a TTS word boundary back to the tile being spoken.
 */
import { leadAfter, type LanguagePack, type SentenceView, type SpeakCue, type StoryScreen } from '@cliffword/engine';
import type { WordSpan } from '../../adapters/speechOut/types';
import { withCommandHints } from '../common/listen';
import { wordSpansOf } from '../common/speaker';

/** The word and number segments of a text as spans, in order (src/session/common/speaker.ts). */
export { wordSpansOf };

/** The words to pass to SpeechOut for a cue, and the ViewWord index each one speaks (or null). */
export interface CuePlan {
  spans: WordSpan[];
  viewIndex: (number | null)[];
}

/** The sentence on screen, when the screen shows one. */
export function sentenceOf(screen: StoryScreen | null): SentenceView | null {
  if (!screen) return null;
  switch (screen.kind) {
    case 'cliff':
    case 'landing':
    case 'noSe':
      return screen.sentence;
    case 'nativeReply':
      return screen.sentence ?? null;
    default:
      return null;
  }
}

/**
 * Plan a cue. When the cue's text is part of the sentence on screen (the sentence up to the
 * cliff, the whole line, the answer), its spans are the sentence's own word segments inside
 * it, so each boundary names a tile; `startWord` picks the occurrence that starts at that
 * ViewWord (the cliff's first word for an answer). Otherwise the cue's text is segmented on
 * its own and no tile is lit.
 */
export function planCue(pack: Pick<LanguagePack, 'segment'>, cueText: string, sentence: string | null, startWord?: number | null): CuePlan {
  if (sentence && cueText) {
    const words = wordSpansOf(pack, sentence);
    const preferred = startWord !== undefined && startWord !== null ? words[startWord]?.start : undefined;
    let offset = -1;
    if (preferred !== undefined && sentence.startsWith(cueText, preferred)) offset = preferred;
    else if (sentence.startsWith(cueText)) offset = 0;
    else offset = sentence.indexOf(cueText);
    if (offset >= 0) {
      const end = offset + cueText.length;
      const spans: WordSpan[] = [];
      const viewIndex: number[] = [];
      words.forEach((w, i) => {
        if (w.start >= offset && w.end <= end) {
          spans.push({ text: w.text, start: w.start - offset, end: w.end - offset });
          viewIndex.push(i);
        }
      });
      if (spans.length > 0) return { spans, viewIndex };
    }
  }
  const spans = wordSpansOf(pack, cueText);
  return { spans, viewIndex: spans.map(() => null) };
}

/**
 * A library line's cue as the engine makes it: the whole line while it plays (recall), the line
 * with its gap (recall at the gap, hint: before, a pause, after), or (predict) up to the cliff.
 * null for a cliff that is not a library one.
 */
export function libraryCliffCue(pack: Pick<LanguagePack, 'segment'>, screen: Extract<StoryScreen, { kind: 'cliff' }>): SpeakCue | null {
  if (screen.meta.mode !== 'library' || !screen.mode || screen.mode === 'predict') return null;
  const { text, speechRate: rate } = screen.sentence;
  if (screen.mode === 'recall' && screen.phase === 'playing') return { text, rate, what: 'line' };
  const words = wordSpansOf(pack, text);
  const first = words[screen.cliff.wordIndex];
  const last = words[screen.cliff.wordIndex + screen.cliff.length - 1];
  if (!first || !last) return null;
  const before = text.slice(0, first.start).trim();
  const rest = text.slice(last.end).trim();
  // Closing punctuation alone is no second part.
  const after = wordSpansOf(pack, rest).length > 0 ? rest : '';
  const sep = leadAfter(before);
  return { text: after ? `${before}${sep}…${sep}${after}` : before, rate, what: 'sentence', gap: { before, after } };
}

/**
 * The cue that plays the current screen again ("Hear it again", and after a restart, when
 * the step's own cue is gone): the sentence up to the cliff (a library line as libraryCliffCue
 * plays it), the whole line, the answer, the target phrase, the character's question, the scene
 * or the register prompt.
 */
export function cueForScreen(pack: Pick<LanguagePack, 'segment'>, screen: StoryScreen | null): SpeakCue | null {
  if (!screen) return null;
  switch (screen.kind) {
    case 'cliff': {
      const library = libraryCliffCue(pack, screen);
      if (library) return library;
      const start = wordSpansOf(pack, screen.sentence.text)[screen.cliff.wordIndex]?.start;
      if (start === undefined) return null;
      const text = screen.sentence.text.slice(0, start).trimEnd();
      return text ? { text, rate: screen.sentence.speechRate, what: 'sentence' } : null;
    }
    case 'landing':
      return { text: screen.sentence.text, rate: screen.sentence.speechRate, what: 'sentence' };
    case 'noSe':
      return { text: screen.answer, rate: screen.sentence.speechRate, what: 'answer' };
    case 'nativeReply':
      return screen.target ? { text: screen.target, rate: screen.sentence?.speechRate ?? 1, what: 'answer' } : null;
    case 'turn':
    case 'repair':
      return { text: screen.prompt.line, rate: 1, what: 'prompt' };
    case 'episodeDone':
    case 'trackDone':
      return null;
    case 'retell':
      return screen.scene ? { text: screen.scene, rate: 1, what: 'scene' } : null;
    case 'register':
      return { text: screen.task.prompt, rate: 1, what: 'prompt' };
    default:
      return null;
  }
}

/**
 * Words and phrases the recognizer should expect on this screen, before the pack's commands:
 * the visible words of the sentence, the options, the answer or target to repeat, the
 * character's question, the expected repair or register answer.
 */
export function storyHintWords(pack: Pick<LanguagePack, 'segment'>, screen: StoryScreen | null): (string | null | undefined)[] {
  const out: (string | null | undefined)[] = [];
  const sentence = sentenceOf(screen);
  for (const w of sentence?.words ?? []) if (w.display !== 'masked') out.push(w.text);
  if (screen?.kind === 'cliff') for (const o of screen.cliff.options ?? []) out.push(o.text);
  if (screen?.kind === 'noSe') out.push(screen.answer);
  if (screen?.kind === 'nativeReply') out.push(screen.target);
  if (screen?.kind === 'turn' || screen?.kind === 'repair') for (const w of wordSpansOf(pack, screen.prompt.line)) out.push(w.text);
  if (screen?.kind === 'repair') out.push(screen.expected);
  if (screen?.kind === 'register') out.push(screen.task.expected);
  return out;
}

/**
 * The recognizer hints of a screen: its words (storyHintWords) and the pack's spoken commands,
 * without repeats, capped at MAX_HINTS (src/session/common/listen.ts).
 */
export function hintsFor(pack: Pick<LanguagePack, 'segment' | 'commands'>, screen: StoryScreen | null): string[] {
  return withCommandHints(pack, storyHintWords(pack, screen));
}
