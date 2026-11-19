/**
 * The episode screen of an experience: one clear action at a time, under the story so far.
 *
 * - Header: close (back to the Story home), "Episode 1 · Good morning, Pancho", "Line 3 of 12"
 *   with a progress bar.
 * - The story so far scrolls above the line on screen: the episode's scene as a banner, then the
 *   earlier lines as a conversation (Transcript.tsx, vm.transcript); the view scrolls to the line
 *   on screen whenever it changes, and the scene scrolls away as the conversation grows.
 * - A line: the speaker's avatar and name above dialogue, the line as large text (tap it to show or
 *   hide the English and the pictures of its words), then by cliff mode:
 *   recall: the whole line plays (shown), then the gap with three big options and the mic;
 *   hint: the English with the gap word in bold above, the mic first, "Show options" second;
 *   predict: the mic first, "No sé" second.
 * - Feedback after every answer (Feedback.tsx) and one "Next".
 * - A character's question (their avatar and "Doña Mari asks you"): tap for the English, the mic,
 *   "Show me an example", the reply and the example answer; the repair card when the model judged
 *   a reply.
 * - The end of an episode (a fun summary, the level line, "Next episode") and of the experience
 *   (celebrate, pick another).
 * The mic is the big round button at the bottom center (MicButton). Display text from the engine
 * is a UiText, resolved with t(key, params); story text is data.
 */
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CliffMode, LibraryMeta, LibraryProgress, SentenceView, StoryScreen, TranslationHint } from '@cliffword/engine';
import { HeatSentence } from '../../../components/words/HeatSentence';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../../components/words/fontScale';
import { languageName, useI18n } from '../../../i18n';
import type { StoryActions, StoryViewModel } from '../../../session/contract';
import { borders, colors, layout, radii, spacing } from '../../../theme';
import { usePairPack } from '../../../engine/PacksProvider';
import { vocabInText, type WordPicture } from '../../../illustrations';
import { Button, Card, ContentText, InterfaceText, QuietLink } from '../../../ui';
import { episodeRows } from '../../experiences/experiences';
import { NoticeToast } from '../NoticeToast';
import { TypeAnswerSheet } from '../TypeAnswerSheet';
import { CoachMark, type GuideTip } from './CoachMark';
import { Feedback } from './Feedback';
import { LineText } from './LineText';
import { MicButton } from './MicButton';
import { SceneBanner, SpeakerLabel, WordPictures } from './Pictures';
import { Transcript } from './Transcript';

export interface EpisodeViewProps {
  vm: StoryViewModel;
  actions: StoryActions;
  /** The coach mark to show now (first episode only), or null. */
  guide?: GuideTip | null;
  onGuideNext?: () => void;
  onGuideSkip?: () => void;
  /** The experience is done: open the picker. */
  onPickExperience?: () => void;
}

type Cliff = Extract<StoryScreen, { kind: 'cliff' }>;

/** Screens of a line or a question of the episode: the story so far shows above them. */
const IN_EPISODE: ReadonlySet<StoryScreen['kind']> = new Set<StoryScreen['kind']>(['cliff', 'landing', 'noSe', 'nativeReply', 'turn', 'repair']);

/** After the line on screen changes, content that grows within this time keeps the view at the bottom. */
const FOLLOW_MS = 1200;

/**
 * What the learner is looking at: when it changes (a new line, the gap, the feedback, a reply), the
 * view scrolls to the bottom, where it is. Showing the English of an earlier line does not.
 */
function focusKey(screen: StoryScreen | null, vm: StoryViewModel): string {
  if (!screen) return '';
  const lib = screen.meta.library;
  const parts: (string | number | boolean | null | undefined)[] = [screen.kind, lib?.storyId, lib?.lineId, lib?.line, vm.transcript?.entries.length];
  if (screen.kind === 'cliff') parts.push(screen.phase, screen.cliff.rung, screen.missed);
  if (screen.kind === 'noSe') parts.push(screen.step);
  if (screen.kind === 'turn') parts.push(screen.example, screen.reply?.heard);
  if (screen.kind === 'repair') parts.push(screen.phase, screen.attempts);
  return parts.map((p) => String(p ?? '')).join('|');
}

export function EpisodeView({ vm, actions, guide = null, onGuideNext, onGuideSkip, onPickExperience }: EpisodeViewProps) {
  const { t } = useI18n();
  const pair = usePairPack();
  const language = languageName(t, pair.target);
  const [typing, setTyping] = useState(false);
  const screen = vm.screen;
  // The gap of the cliff screen before a landing: the story's word is drawn there. Kept from
  // render to render (state set while rendering, only when the cliff changed).
  const [lastCliff, setLastCliff] = useState<{ lineId: string | null; wordIndex: number; length: number } | null>(null);
  if (screen?.kind === 'cliff') {
    const lineId = screen.meta.library?.lineId ?? null;
    if (lastCliff?.lineId !== lineId || lastCliff.wordIndex !== screen.cliff.wordIndex || lastCliff.length !== screen.cliff.length) {
      setLastCliff({ lineId, wordIndex: screen.cliff.wordIndex, length: screen.cliff.length });
    }
  }
  const span = screen?.kind === 'landing' && lastCliff && lastCliff.lineId === (screen.meta.library?.lineId ?? null) ? lastCliff : null;

  const lib = screen?.meta.library;
  const inEpisode = screen !== null && IN_EPISODE.has(screen.kind) && lib !== undefined;
  const transcript = inEpisode && vm.transcript && vm.transcript.storyId === lib?.storyId ? vm.transcript : null;
  // The view follows the line on screen: to the bottom when it changes, and while it lays out.
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const follow = useRef(0);
  const focus = focusKey(screen, vm);
  useEffect(() => {
    follow.current = Date.now() + FOLLOW_MS;
    scroll.current?.scrollToEnd({ animated: true });
  }, [focus]);

  const listening = vm.listen.phase === 'warming' || vm.listen.phase === 'listening';
  const mic = (
    <MicButton
      listen={vm.listen}
      latched={vm.micLatched ?? false}
      actions={actions}
      onType={() => {
        if (listening) actions.holdCancel();
        setTyping(true);
      }}
      disabled={vm.busy && !listening}
    />
  );
  const next = <Button label={t('feedback.next')} onPress={actions.next} disabled={vm.busy} testID="episode-next" />;

  let body: ReactNode = null;
  let dock: ReactNode = null;
  switch (screen?.kind) {
    case 'cliff': {
      const parts = cliffParts(screen, vm, actions, t);
      body = parts.body;
      dock = parts.dock === 'mic' ? mic : null;
      break;
    }
    case 'landing':
      body = (
        <View style={styles.stack}>
          <Feedback screen={screen} modelReady={vm.modelMode === 'model'} speakingWord={vm.speakingWord} answerSpan={span} />
          {actions.reportSentence ? (
            <QuietLink
              role="button"
              label={t('story.report')}
              accessibilityHint={t('story.report.hint')}
              onPress={actions.reportSentence}
              maxFontSizeMultiplier={CHROME_MAX_SCALE}
              testID="report-sentence"
            />
          ) : null}
        </View>
      );
      dock = next;
      break;
    case 'noSe':
      body = (
        <View style={styles.stack} testID="episode-nose">
          <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {t('feedback.word', { word: screen.answer })}
          </ContentText>
          <SpeakerLabel trackId={lib?.track} speakerId={lib?.speakerId} label={screen.speaker ?? null} />
          <LineText sentence={screen.sentence} speakingWord={vm.speakingWord} testID="nose-line" />
          {screen.translation ? <English text={screen.translation} /> : null}
          <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {screen.ui ? t(screen.ui.key, screen.ui.params) : t('feedback.repeat')}
          </InterfaceText>
          {screen.repeat ? (
            <InterfaceText variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t(screen.repeat.ui.key, screen.repeat.ui.params)}
            </InterfaceText>
          ) : null}
        </View>
      );
      dock = (
        <View style={styles.dockStack}>
          {screen.step !== 'done' ? mic : null}
          {next}
        </View>
      );
      break;
    case 'nativeReply':
      body = (
        <View style={styles.stack} testID="episode-native">
          {screen.ui ? (
            <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t(screen.ui.key, screen.ui.params)}
            </InterfaceText>
          ) : null}
          {screen.target ? (
            <ContentText variant="headline" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
              {screen.target}
            </ContentText>
          ) : null}
          {screen.sentence ? <LineText sentence={screen.sentence} testID="native-line" /> : null}
        </View>
      );
      dock = (
        <View style={styles.dockStack}>
          {mic}
          {next}
        </View>
      );
      break;
    case 'turn':
    case 'repair':
      ({ body, dock } = turnParts(screen, actions, t, language, mic, next));
      break;
    case 'episodeDone':
      body = (
        <View style={styles.stack}>
          <SceneBanner trackId={screen.track} episode={screen.episode} />
          <EpisodeDone screen={screen} />
        </View>
      );
      dock = (
        <View style={styles.dockStack}>
          {screen.next ? (
            <Button label={screen.replay ? t('story.continue') : t('episodeDone.next')} onPress={actions.next} disabled={vm.busy} testID="episode-done-next" />
          ) : (
            <Button label={t('story.continue')} onPress={actions.next} disabled={vm.busy} testID="episode-done-next" />
          )}
          <Button variant="outline" label={t('episodeDone.home')} onPress={actions.closeEpisode} testID="episode-done-home" />
        </View>
      );
      break;
    case 'trackDone':
      body = <TrackDone screen={screen} />;
      dock = (
        <View style={styles.dockStack}>
          {onPickExperience && screen.suggestions.length > 0 ? (
            <Button label={t('trackDone.pick')} onPress={onPickExperience} testID="track-done-pick" />
          ) : null}
          <Button variant={screen.suggestions.length > 0 ? 'outline' : 'primary'} label={t('episodeDone.home')} onPress={actions.closeEpisode} testID="track-done-home" />
        </View>
      );
      break;
    case 'error':
      body = (
        <Card testID="episode-error">
          <InterfaceText maxFontSizeMultiplier={CHROME_MAX_SCALE}>{t(screen.ui.key, screen.ui.params)}</InterfaceText>
        </Card>
      );
      dock = <Button label={t('common.retry')} onPress={actions.next} disabled={vm.busy} testID="episode-retry" />;
      break;
    default:
      body = (
        <InterfaceText tone="muted" accessibilityRole="progressbar" accessibilityLabel={t('story.busy')} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('story.busy')}
        </InterfaceText>
      );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.root} testID="episode-screen">
      <EpisodeHeader screen={screen} library={vm.library ?? null} onClose={actions.closeEpisode} busy={vm.busy} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (Date.now() < follow.current) scroll.current?.scrollToEnd({ animated: true });
        }}
        testID="episode-scroll"
      >
        {inEpisode && lib ? (
          <View style={styles.story} testID="episode-story-so-far">
            <SceneBanner trackId={lib.track} episode={lib.episode} />
            {transcript ? <Transcript transcript={transcript} /> : null}
          </View>
        ) : null}
        {body}
      </ScrollView>
      {dock ? <View style={styles.dock}>{dock}</View> : null}
      <NoticeToast notice={vm.notice} onDismiss={actions.dismissNotice} />
      <TypeAnswerSheet
        visible={typing}
        onSubmit={(text) => {
          setTyping(false);
          actions.typeAnswer(text);
        }}
        onClose={() => setTyping(false)}
      />
      {guide && onGuideNext && onGuideSkip ? (
        <CoachMark tip={guide} place={guide === 'listen' ? 'middle' : 'bottom'} onNext={onGuideNext} onSkip={onGuideSkip} />
      ) : null}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function EpisodeHeader({ screen, library, onClose, busy }: { screen: StoryScreen | null; library: LibraryProgress | null; onClose: () => void; busy: boolean }) {
  const { t } = useI18n();
  const pair = usePairPack();
  const lib = screen?.meta.library;
  const row = lib && library ? episodeRows(pair, library, lib.track).find((r) => r.episode === lib.episode) : undefined;
  const titleNative = screen?.kind === 'episodeDone' ? screen.titleNative : (row?.title ?? null);
  const title = lib ? t('episode.header', { n: lib.episode, title: titleNative || screen?.meta.title || '' }) : '';
  const line = lib && lib.lines > 0 && lib.line > 0 ? Math.min(lib.line, lib.lines) : 0;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('episode.close')}
        onPress={onClose}
        hitSlop={4}
        testID="episode-close"
        style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
      >
        <View style={[styles.closeBar, styles.closeA]} />
        <View style={[styles.closeBar, styles.closeB]} />
      </Pressable>
      <View style={styles.headerText}>
        <InterfaceText variant="rowTitle" numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-title">
          {title}
        </InterfaceText>
        {line > 0 && lib ? (
          <View style={styles.progressRow}>
            <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-progress">
              {t('episode.progress', { n: line, total: lib.lines })}
            </InterfaceText>
            <View
              style={styles.track}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: lib.lines, now: line }}
              accessibilityLabel={t('episode.progress', { n: line, total: lib.lines })}
            >
              <View style={[styles.fill, { width: `${Math.round((100 * line) / lib.lines)}%` }]} />
            </View>
          </View>
        ) : null}
      </View>
      {busy ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-busy">
          {t('story.busy')}
        </InterfaceText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// A line with its gap
// ---------------------------------------------------------------------------

type Translate = ReturnType<typeof useI18n>['t'];

function cliffParts(screen: Cliff, vm: StoryViewModel, actions: StoryActions, t: Translate): { body: ReactNode; dock: 'mic' | null } {
  const mode: CliffMode = screen.mode ?? 'predict';
  const playing = mode === 'recall' && screen.phase === 'playing';
  const options = screen.cliff.options ?? [];
  const showOptions = options.length > 0 && !playing;
  const hintMode = mode === 'hint';
  const prompt = t(screen.cliff.ui.key, screen.cliff.ui.params);
  const body = (
    <View style={styles.stack} testID={`episode-cliff-${mode}`}>
      {hintMode && screen.translation ? <HintTranslation text={screen.translation} hint={screen.translationHint ?? null} /> : null}
      <LineCard
        key={screen.meta.library?.lineId ?? screen.sentence.text}
        screen={screen}
        speakingWord={vm.speakingWord}
        canToggle={!hintMode && Boolean(screen.translation)}
      />
      <InterfaceText variant="bodyStrong" tone={playing ? 'muted' : 'ink'} accessibilityLiveRegion="polite" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="cliff-prompt">
        {playing ? t('episode.listening') : prompt}
      </InterfaceText>
      {showOptions ? (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={prompt} testID="cliff-options">
          {options.map((o) => (
            <Pressable
              key={o.index}
              accessibilityRole="button"
              accessibilityLabel={t('episode.option.a11y', { text: o.text })}
              onPress={() => actions.pickOption(o.index)}
              disabled={vm.busy}
              testID={`option-${o.index}`}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <ContentText variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                {o.text}
              </ContentText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <Button variant="outline" label={t('episode.listenAgain')} onPress={actions.replay} testID="listen-again" />
        {!playing && !showOptions && mode === 'hint' ? (
          <Button variant="outline" label={t('episode.showOptions')} onPress={() => actions.command('dont_know')} testID="show-options" />
        ) : null}
        {!playing && !showOptions && mode === 'predict' ? (
          <Button
            variant="outline"
            label={t('episode.noSe')}
            accessibilityHint={t('episode.noSe.hint')}
            onPress={() => actions.command('dont_know')}
            testID="no-se"
          />
        ) : null}
      </View>
    </View>
  );
  return { body, dock: playing ? null : 'mic' };
}

/**
 * The line with its speaker (avatar and name); a tap shows or hides the English and the pictures
 * of the words on show (when the mode allows it).
 */
function LineCard({ screen, speakingWord, canToggle }: { screen: Cliff; speakingWord: number | null; canToggle: boolean }) {
  const { t } = useI18n();
  const [english, setEnglish] = useState(false);
  const speaker = screen.speaker ?? null;
  const lib = screen.meta.library;
  const content = (
    <View style={styles.lineCard}>
      <SpeakerLabel trackId={lib?.track} speakerId={lib?.speakerId} label={speaker} />
      <LineText sentence={screen.sentence} speakingWord={speakingWord} testID="episode-line" />
      {canToggle && english && screen.translation ? <English text={screen.translation} /> : null}
      {canToggle && english ? <WordPictures words={shownPictures(screen.sentence)} testID="line-pictures" /> : null}
      {canToggle && !english ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('episode.tapForEnglish')}
        </InterfaceText>
      ) : null}
    </View>
  );
  if (!canToggle) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={lineLabel(screen, speaker, t)}
      accessibilityHint={english ? t('episode.line.hideEnglish') : t('episode.line.showEnglish')}
      accessibilityState={{ expanded: english }}
      onPress={() => setEnglish((e) => !e)}
      testID="line-toggle"
      style={styles.toggle}
    >
      {content}
    </Pressable>
  );
}

/** The line as heard: the words around the gap, the gap named. */
function lineLabel(screen: Cliff, speaker: string | null, t: Translate): string {
  const words = screen.sentence.words.filter((w) => w.display !== 'future' && w.display !== 'masked');
  const before = words.filter((w) => w.index < screen.cliff.wordIndex && w.display !== 'gap');
  const after = words.filter((w) => w.index >= screen.cliff.wordIndex + screen.cliff.length && w.display !== 'gap');
  const gapShown = words.some((w) => w.display === 'gap');
  const join = (ws: typeof words) => ws.map((w) => `${w.lead}${w.text}${w.trail}`).join(' ');
  const text = gapShown ? t('episode.gap.a11y', { before: join(before), after: join(after) }) : join(words);
  return speaker ? t('episode.line.a11y', { speaker, text }) : text;
}

/**
 * Pictures of the words shown as text: never a hidden word (its picture would give the answer
 * away) and never a phrase across the gap.
 */
function shownPictures(sentence: SentenceView): WordPicture[] {
  const runs: string[][] = [[]];
  for (const w of sentence.words) {
    if (w.display === 'text') runs[runs.length - 1]?.push(w.text);
    else runs.push([]);
  }
  const seen = new Set<string>();
  return runs
    .flatMap((run) => vocabInText(run.join(' ')))
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
}

function English({ text }: { text: string }) {
  return (
    <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-english">
      {text}
    </InterfaceText>
  );
}

/** Hint mode: the line in English with the gap word in bold. */
function HintTranslation({ text, hint }: { text: string; hint: TranslationHint | null }) {
  const found = hint?.found && hint.end > hint.start;
  return (
    <Card tone="soft" testID="hint-translation">
      <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {found && hint ? text.slice(0, hint.start) : text}
        {found && hint ? (
          <InterfaceText variant="bodyStrong" style={styles.bold} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="hint-word">
            {text.slice(hint.start, hint.end)}
          </InterfaceText>
        ) : null}
        {found && hint ? text.slice(hint.end) : null}
      </InterfaceText>
      {hint && !found ? (
        <InterfaceText variant="bodyStrong" style={styles.bold} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="hint-word">
          {hint.text}
        </InterfaceText>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// A character's question
// ---------------------------------------------------------------------------

type Turn = Extract<StoryScreen, { kind: 'turn' }>;
type Repair = Extract<StoryScreen, { kind: 'repair' }>;

function turnParts(screen: Turn | Repair, actions: StoryActions, t: Translate, language: string, mic: ReactNode, next: ReactNode): { body: ReactNode; dock: ReactNode } {
  const example = screen.example ?? null;
  const reply = screen.kind === 'turn' ? (screen.reply ?? null) : null;
  const done = screen.kind === 'repair' ? screen.done : example !== null;
  const lib: LibraryMeta | undefined = screen.meta.library;
  const body = (
    <View style={styles.stack} testID={`episode-${screen.kind}`}>
      <SpeakerLabel trackId={lib?.track} speakerId={lib?.speakerId} label={t('story.asks', { speaker: screen.prompt.speaker })} testID="turn-speaker" />
      <Question line={screen.prompt.line} translation={screen.translation ?? null} speaker={screen.prompt.speaker} />
      {screen.kind === 'repair' ? <RepairBody screen={screen} /> : null}
      {reply ? (
        <Card testID="turn-reply">
          <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('turn.youSaid', { text: reply.heard })}
          </InterfaceText>
          <InterfaceText variant="bodyStrong" tone={reply.accepted ? 'ink' : 'accent'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t(reply.ui.key, reply.ui.params)}
          </InterfaceText>
        </Card>
      ) : null}
      {screen.exampleUi ? (
        <ContentText variant="prompt" style={styles.example} maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="turn-example">
          {t(screen.exampleUi.key, screen.exampleUi.params)}
        </ContentText>
      ) : null}
      {!done ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('turn.answer', { language })}
        </InterfaceText>
      ) : null}
      {!done && screen.kind === 'turn' ? (
        <View style={styles.row}>
          <Button variant="outline" label={t('episode.listenAgain')} onPress={actions.replay} testID="listen-again" />
          <Button variant="outline" label={t('turn.showExample')} onPress={() => actions.command('dont_know')} testID="turn-example-button" />
        </View>
      ) : null}
    </View>
  );
  return { body, dock: done ? next : mic };
}

function Question({ line, translation, speaker }: { line: string; translation: string | null; speaker: string }) {
  const { t } = useI18n();
  const [english, setEnglish] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('episode.line.a11y', { speaker, text: line })}
      accessibilityHint={english ? t('episode.line.hideEnglish') : t('episode.line.showEnglish')}
      accessibilityState={{ expanded: english }}
      disabled={!translation}
      onPress={() => setEnglish((e) => !e)}
      testID="question-toggle"
      style={[styles.lineCard, styles.toggle]}
    >
      <ContentText variant="story" style={styles.question} maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="turn-question">
        {line}
      </ContentText>
      {translation && english ? <English text={translation} /> : null}
      {translation && english ? <WordPictures words={vocabInText(line)} testID="question-pictures" /> : null}
      {translation && !english ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('episode.tapForEnglish')}
        </InterfaceText>
      ) : null}
    </Pressable>
  );
}

/** The model judged the reply: what was said (shaded by surprise), the repair prompt, the fix and why. */
function RepairBody({ screen }: { screen: Repair }) {
  const { t } = useI18n();
  return (
    <Card testID="repair-card">
      {screen.said.length > 0 ? <HeatSentence said={screen.said} highlight={screen.highlight} /> : null}
      {screen.ui ? (
        <InterfaceText variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="repair-ui">
          {t(screen.ui.key, screen.ui.params)}
        </InterfaceText>
      ) : null}
      {screen.explanation ? (
        <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="repair-explanation">
          {screen.explanation}
        </InterfaceText>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The end of an episode, of an experience
// ---------------------------------------------------------------------------

function EpisodeDone({ screen }: { screen: Extract<StoryScreen, { kind: 'episodeDone' }> }) {
  const { t } = useI18n();
  // Right answers (a tapped option too) and those given without the options (the level rule).
  // A learner who tapped every word right hears how to move up, not that it was tricky.
  const correct = screen.correct ?? screen.unaided;
  const unaidedShare = screen.cliffs > 0 ? screen.unaided / screen.cliffs : 1;
  const correctShare = screen.cliffs > 0 ? correct / screen.cliffs : 1;
  const cheer =
    unaidedShare >= 0.8
      ? t('episodeDone.great')
      : correctShare >= 0.8 && screen.levelChange <= 0
        ? t('episodeDone.sayMore')
        : correctShare >= 0.5
          ? t('episodeDone.good')
          : t('episodeDone.keep');
  return (
    <View style={styles.stack} testID="episode-done">
      <Confetti />
      <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('episodeDone.title', { n: screen.episode })}
      </ContentText>
      <ContentText variant="title" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {screen.titleNative}
      </ContentText>
      <Card>
        <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-done-score">
          {t('episodeDone.score', { correct, cliffs: screen.cliffs })}
        </InterfaceText>
        <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-done-unaided">
          {t('episodeDone.unaided', { unaided: screen.unaided })}
        </InterfaceText>
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {cheer}
        </InterfaceText>
        <InterfaceText variant="bodyStrong" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-done-level">
          {t(screen.levelUi.key, screen.levelUi.params)}
        </InterfaceText>
      </Card>
      {screen.replay ? (
        <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('episodeDone.replay')}
        </InterfaceText>
      ) : screen.next ? (
        <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="episode-done-up-next">
          {t('episodeDone.nextTitle', { title: screen.next.titleNative })}
        </InterfaceText>
      ) : null}
    </View>
  );
}

function TrackDone({ screen }: { screen: Extract<StoryScreen, { kind: 'trackDone' }> }) {
  const { t } = useI18n();
  return (
    <View style={styles.stack} testID="track-done">
      <Confetti />
      <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('trackDone.title', { title: screen.title })}
      </ContentText>
      <InterfaceText maxFontSizeMultiplier={CHROME_MAX_SCALE}>{t('trackDone.body')}</InterfaceText>
      {screen.suggestions.length === 0 ? (
        <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('trackDone.soon')}
        </InterfaceText>
      ) : (
        screen.suggestions.map((s) => (
          <Card key={s.id}>
            <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {s.title}
            </InterfaceText>
            <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {s.tagline}
            </InterfaceText>
          </Card>
        ))
      )}
    </View>
  );
}

/** A few colored dots: a small celebration (decorative). */
function Confetti() {
  const dots = [colors.heat3, colors.live, colors.heat2, colors.ink, colors.heat1, colors.accentText];
  return (
    <View style={styles.confetti} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {dots.map((c, i) => (
        <View key={i} style={[styles.dot, { backgroundColor: c, marginTop: (i % 3) * 8 }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.borderSoft,
  },
  close: { width: layout.minTouch, height: layout.minTouch, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  closePressed: { backgroundColor: colors.borderSoft },
  closeBar: { position: 'absolute', width: 18, height: 2, borderRadius: 1, backgroundColor: colors.ink },
  closeA: { transform: [{ rotate: '45deg' }] },
  closeB: { transform: [{ rotate: '-45deg' }] },
  headerText: { flex: 1, gap: spacing.xxs },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { flex: 1, height: 4, borderRadius: radii.pill, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.ink },
  content: { paddingHorizontal: layout.screenPaddingX, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  story: { gap: spacing.lg },
  stack: { gap: spacing.lg },
  lineCard: { gap: spacing.sm },
  toggle: { minHeight: layout.minTouch },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  options: { gap: spacing.sm },
  option: {
    minHeight: layout.primaryHeight,
    borderRadius: radii.button,
    borderWidth: borders.strong,
    borderColor: colors.ink,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  optionPressed: { backgroundColor: colors.heat1 },
  bold: { color: colors.ink },
  question: { fontSize: 28, lineHeight: 38 },
  example: { color: colors.accentText },
  dock: { paddingHorizontal: layout.screenPaddingX, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm },
  dockStack: { gap: spacing.sm },
  confetti: { flexDirection: 'row', gap: spacing.sm, height: 28 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});

