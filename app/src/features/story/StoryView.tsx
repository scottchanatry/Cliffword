/**
 * The Story tab: renders the controller's StoryViewModel (src/session/contract.ts) and calls
 * its StoryActions. The engine's StoryScreen is the view data: each kind has its view
 * (cliff, landing, noSe, nativeReply, turn, repair, upNext, retell, register, placementDone,
 * error, idle) and a null screen is a calm loading state.
 *
 * Around every screen: hold anywhere to speak (HoldAnywhere, the root gesture), the meaning
 * sheet, the "Type instead" sheet and the notice toast. Nothing here blocks commands while a
 * session call is in flight; the header shows a quiet spinner instead.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { HoldAnywhere } from '../../components/voice/HoldAnywhere';
import { useListenToggle } from '../../components/voice/useListenToggle';
import type { StoryActions, StoryViewModel } from '../../session/contract';
import { colors, layout, spacing } from '../../theme';
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

export interface StoryViewProps {
  vm: StoryViewModel;
  actions: StoryActions;
}

export function StoryView({ vm, actions }: StoryViewProps) {
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
  content: {
    flexGrow: 1,
    gap: layout.screenGap,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: layout.screenPaddingBottom,
  },
});
