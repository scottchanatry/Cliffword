/**
 * "Report this sentence" (docs/STORE.md decision 6, Google Play's AI-generated content policy):
 * the story sentence on screen, written into a mail to CONTACT_EMAIL that the learner sends from
 * their own mail app. Nothing leaves the phone unless they press Send there, so the privacy
 * answers stay "no data collected".
 *
 * The mail carries the sentence, whether the on-device model wrote it or it is canned starter
 * content (StoryMeta.canned), the screen and chapter, the app version and the platform.
 */
import type { StoryScreen } from '@cliffword/engine';
import { CONTACT_EMAIL, mailtoUrl } from '../../config/links';
import type { Translator } from '../../i18n/translator';

/** The screens that show a story sentence (or a story character's line) a learner can report. */
export const REPORTABLE_KINDS: ReadonlySet<StoryScreen['kind']> = new Set<StoryScreen['kind']>([
  'cliff',
  'landing',
  'noSe',
  'nativeReply',
  'turn',
  'repair',
]);

export interface ReportedSentence {
  /** The whole sentence as the session made it (on a cliff, with the words after the gap). */
  text: string;
  /** Canned starter content (no model), rather than a sentence the model wrote. */
  canned: boolean;
  kind: StoryScreen['kind'];
  chapter: number;
}

/** The app as a report names it: version, native build (null in development) and platform. */
export interface ReportAppInfo {
  version: string;
  build: string | null;
  platform: string;
}

/** The sentence a screen shows, or null for a screen without one (retell, up next, ...). */
export function reportableSentence(screen: StoryScreen | null): ReportedSentence | null {
  if (!screen) return null;
  let text: string | null;
  switch (screen.kind) {
    case 'cliff':
    case 'landing':
    case 'noSe':
      text = screen.sentence.text;
      break;
    case 'nativeReply':
      text = screen.sentence?.text ?? null;
      break;
    case 'turn':
    case 'repair':
      text = screen.prompt.line;
      break;
    default:
      return null;
  }
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return { text: trimmed, canned: screen.meta.canned, kind: screen.kind, chapter: screen.meta.chapter };
}

/** The mailto: URL of a report: subject "Cliffword: report a sentence" and the filled-in body. */
export function sentenceReportUrl(t: Translator['t'], sentence: ReportedSentence, app: ReportAppInfo, to: string = CONTACT_EMAIL): string {
  const version = app.build ? t('report.mail.version', { version: app.version, build: app.build }) : app.version;
  const source = sentence.canned ? t('report.mail.source.canned') : t('report.mail.source.model');
  return mailtoUrl(to, {
    subject: t('report.mail.subject'),
    body: t('report.mail.body', {
      sentence: sentence.text,
      source,
      screen: sentence.kind,
      chapter: sentence.chapter,
      version,
      platform: app.platform,
    }),
  });
}
