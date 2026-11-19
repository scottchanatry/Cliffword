/**
 * The Story tab: renders the controller's StoryViewModel (src/session/contract.ts) and calls
 * its StoryActions. In library mode (an experience; vm.library) it is ./library/LibraryStory:
 * the Story home, the episode screen and the experience picker. The rest of this file is the
 * generated flow. The engine's StoryScreen is the view data: each kind has its view
 * (cliff, landing, noSe, nativeReply, turn, repair, upNext, retell, register, placementDone,
 * error, idle) and a null screen is a calm loading state.
 *
 * Around every screen: hold anywhere to speak (HoldAnywhere, the root gesture), the meaning
 * sheet, the "Type instead" sheet and the notice toast. Under a screen that shows a story
 * sentence, a quiet "Report this sentence" link when the controller offers reportSentence. Nothing here blocks commands while a
 * session call is in flight; the header shows a quiet spinner instead.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import type { StoryScreen } from '@cliffword/engine';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { HoldAnywhere } from '../../components/voice/HoldAnywhere';
import { useListenToggle } from '../../components/voice/useListenToggle';
import { useI18n } from '../../i18n';
import type { StoryActions, StoryViewModel } from '../../session/contract';
import { colors, layout, spacing } from '../../theme';
import { QuietLink } from '../../ui';
import { CliffView } from './CliffView';
import { LandingView } from './LandingView';
import { MeaningSheet } from './MeaningSheet';
import { NativeReplyView } from './NativeReplyView';
import { NoSeView } from './NoSeView';
import { NoticeToast } from './NoticeToast';
import { RegisterView } from './RegisterView';
import { RetellView } from './RetellView';
import { ErrorView, IdleView, LoadingView, PlacementDoneView } from './SimpleViews';
import { RepairView, TurnView } from './TurnView';
import { TypeAnswerSheet } from './TypeAnswerSheet';
import { UpNextView } from './UpNextView';
import { LibraryStory, type LibraryStoryOptions } from './library/LibraryStory';

export interface StoryViewProps {
  vm: StoryViewModel;
  actions: StoryActions;
  /**
   * Library mode (vm.library set: the session plays an experience): the Story home, the episode
   * screen and the picker (./library). These are what the route adds: storing a picked
   * experience, the first-episode guide, the language model's line.
   */
  library?: LibraryStoryOptions;
}

/**
 * The screens that show a story sentence (or a character's line) a learner can report; the
 * controller's reportableSentence (src/session/story/report.ts) reads the same ones.
 */
export function showsReportableSentence(screen: StoryScreen | null): boolean {
  switch (screen?.kind) {
    case 'cliff':
    case 'landing':
    case 'noSe':
    case 'turn':
    case 'repair':
      return true;
    case 'nativeReply':
      return screen.sentence !== undefined;
    default:
      return false;
  }
}

export function StoryView({ vm, actions, library }: StoryViewProps) {
  if (vm.library) return <LibraryStory vm={vm} actions={actions} {...library} />;
  return <GeneratedStoryView vm={vm} actions={actions} />;
}

/** The generated flow (a pair without a library, or options.source 'generated'). */
function GeneratedStoryView({ vm, actions }: StoryViewProps) {
  const { t } = useI18n();
  const [typing, setTyping] = useState(false);
  const toggleListen = useListenToggle(vm.listen, actions);
  const openTyping = useCallback(() => setTyping(true), []);
  const closeTyping = useCallback(() => setTyping(false), []);
  const submitTyped = useCallback(
    (text: string) => {
      setTyping(false);
      actions.typeAnswer(text);
    },
    [actions],
  );
  const screen = vm.screen;
  const listens = screen !== null && screen.kind !== 'idle' && screen.kind !== 'error' && screen.kind !== 'placementDone';
  const common = { vm, actions, toggleListen, openTyping };

  let body: ReactNode;
  switch (screen?.kind) {
    case undefined:
      body = <LoadingView />;
      break;
    case 'cliff':
      body = <CliffView screen={screen} {...common} />;
      break;
    case 'landing':
      body = <LandingView screen={screen} {...common} />;
      break;
    case 'noSe':
      body = <NoSeView screen={screen} {...common} />;
      break;
    case 'nativeReply':
      body = <NativeReplyView screen={screen} {...common} />;
      break;
    case 'turn':
      body = <TurnView screen={screen} {...common} />;
      break;
    case 'repair':
      body = <RepairView screen={screen} {...common} />;
      break;
    case 'upNext':
      body = <UpNextView screen={screen} {...common} />;
      break;
    case 'retell':
      body = <RetellView screen={screen} {...common} />;
      break;
    case 'register':
      body = <RegisterView screen={screen} {...common} />;
      break;
    case 'placementDone':
      body = <PlacementDoneView screen={screen} {...common} />;
      break;
    case 'error':
      body = <ErrorView screen={screen} {...common} />;
      break;
    case 'idle':
      body = <IdleView screen={screen} {...common} />;
      break;
  }

  return (
    <HoldAnywhere actions={actions} enabled={listens} testID="story-view" style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="story-scroll"
      >
        {body}
        {actions.reportSentence && showsReportableSentence(screen) ? (
          <QuietLink
            role="button"
            label={t('story.report')}
            accessibilityHint={t('story.report.hint')}
            onPress={actions.reportSentence}
            maxFontSizeMultiplier={CHROME_MAX_SCALE}
            style={styles.report}
            testID="story-report"
          />
        ) : null}
      </ScrollView>
      <NoticeToast notice={vm.notice} onDismiss={actions.dismissNotice} />
      <MeaningSheet meaning={vm.meaning} onClose={actions.closeMeaning} />
      <TypeAnswerSheet visible={typing} onSubmit={submitTyped} onClose={closeTyping} />
    </HoldAnywhere>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.ground },
  scroll: { flex: 1 },
  // A footer: close under the screen's last control, quieter than the screen gap.
  report: { marginTop: -spacing.md },
  content: {
    flexGrow: 1,
    gap: layout.screenGap,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: layout.screenPaddingBottom,
  },
});
