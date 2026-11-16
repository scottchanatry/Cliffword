/**
 * A song page (or a brought text): renders the controller's LyricViewModel
 * (src/session/contract.ts) and calls its LyricActions. The engine's LyricScreen is the view
 * data: one view per kind (read A3, line, cliff C1, result, noSe, nativeReply, echo B4,
 * registers C2, done); a null screen is a calm loading state. A brought text
 * (meta.source 'text') reads with surprise shading and has Ink-look cliffs.
 *
 * Around every screen: hold anywhere to speak (HoldAnywhere, the root gesture), the meaning
 * sheet, the "Type instead" sheet and the notice toast. Nothing blocks while a session call is
 * in flight; the header shows a quiet spinner instead.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { HoldAnywhere } from '../../components/voice/HoldAnywhere';
import { useListenToggle } from '../../components/voice/useListenToggle';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, layout, spacing } from '../../theme';
import { Text } from '../../ui';
import { MeaningSheet } from '../story/MeaningSheet';
import { NoticeToast } from '../story/NoticeToast';
import { TypeAnswerSheet } from '../story/TypeAnswerSheet';
import { TextCliffView } from '../text/TextCliffView';
import { TextReaderFooter, TextReaderView } from '../text/TextReaderView';
import { EchoView } from './EchoView';
import { LineView } from './LineView';
import { LyricCliffView } from './LyricCliffView';
import { LyricNativeReplyView, LyricNoSeView } from './LyricRepeatViews';
import { LyricResultView } from './LyricResultView';
import { ReadFooter, ReadView } from './ReadView';
import { RegistersView } from './RegistersView';
import { SongDoneView } from './SongDoneView';
import type { SongScreenProps } from './types';

export function SongView({ vm, actions, nav }: SongScreenProps) {
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
  const text = screen?.meta.source === 'text';
  const common = { vm, actions, nav, toggleListen, openTyping };

  let body: ReactNode;
  switch (screen?.kind) {
    case undefined:
      body = <SongLoading />;
      break;
    case 'read':
      body = text ? <TextReaderView screen={screen} {...common} /> : <ReadView screen={screen} {...common} />;
      break;
    case 'line':
      body = <LineView screen={screen} {...common} />;
      break;
    case 'cliff':
      body = text ? <TextCliffView screen={screen} {...common} /> : <LyricCliffView screen={screen} {...common} />;
      break;
    case 'result':
      body = <LyricResultView screen={screen} {...common} />;
      break;
    case 'noSe':
      body = <LyricNoSeView screen={screen} {...common} />;
      break;
    case 'nativeReply':
      body = <LyricNativeReplyView screen={screen} {...common} />;
      break;
    case 'echo':
      body = <EchoView screen={screen} {...common} />;
      break;
    case 'registers':
      body = <RegistersView screen={screen} {...common} />;
      break;
    case 'done':
      body = <SongDoneView screen={screen} {...common} />;
      break;
  }

  return (
    <HoldAnywhere actions={actions} enabled={screen !== null} testID="song-view" style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="song-scroll">
        {body}
      </ScrollView>
      {screen?.kind === 'read' ? (
        <View style={styles.footer}>{text ? <TextReaderFooter actions={actions} /> : <ReadFooter vm={vm} actions={actions} />}</View>
      ) : null}
      <NoticeToast notice={vm.notice} onDismiss={actions.dismissNotice} />
      <MeaningSheet meaning={vm.meaning} onClose={actions.closeMeaning} />
      <TypeAnswerSheet visible={typing} onSubmit={submitTyped} onClose={closeTyping} />
    </HoldAnywhere>
  );
}

/** The controller restores or prepares the song. */
function SongLoading() {
  const { t } = useI18n();
  return (
    <View style={styles.loading} testID="song-loading" accessible accessibilityRole="progressbar" accessibilityLabel={t('music.loading')}>
      <ActivityIndicator color={colors.muted} />
      <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('music.loading')}
      </Text>
    </View>
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
  footer: {
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: layout.screenPaddingBottom,
    backgroundColor: colors.ground,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
});
